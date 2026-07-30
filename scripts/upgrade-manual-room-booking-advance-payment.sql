-- Manual Room Booking Advance Payment and checkout-settlement hardening.
-- Apply after:
--   create-room-booking-tables.sql
--   upgrade-professional-room-operations.sql
--   upgrade-production-room-pricing-gst.sql
--
-- The existing room_booking_payments table remains the financial ledger.
-- room_bookings.advance_paid and balance_amount remain compatibility summaries.

begin;

create table if not exists public.hotel_room_advance_policies (
  hotel_slug text primary key,
  advance_mode text not null default 'optional'
    check (advance_mode in ('disabled','optional','required')),
  minimum_type text not null default 'fixed'
    check (minimum_type in ('fixed','percentage')),
  minimum_value numeric(12,2) not null default 0 check (minimum_value >= 0),
  allow_zero_advance boolean not null default true,
  allow_multiple_payments boolean not null default true,
  allow_split_payments boolean not null default true,
  allow_staff_advance boolean not null default false,
  allowed_payment_methods text[] not null default array['cash','upi','card','bank_transfer']::text[],
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  automatic_cancellation_enabled boolean not null default false,
  version integer not null default 1 check (version > 0),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_room_advance_policy_minimum_check check (
    minimum_type <> 'percentage' or minimum_value <= 100
  ),
  constraint hotel_room_advance_policy_methods_check check (
    cardinality(allowed_payment_methods) between 1 and 20
  )
);

comment on table public.hotel_room_advance_policies is
  'Hotel-scoped policy for optional manual Room booking advances. Existing hotels default to optional zero advance.';

alter table public.room_bookings
  add column if not exists request_fingerprint text;

alter table public.room_booking_payments
  add column if not exists payment_type text not null default 'additional_advance';
alter table public.room_booking_payments
  add column if not exists payment_group_id text;
alter table public.room_booking_payments
  add column if not exists receipt_reference text;
alter table public.room_booking_payments
  add column if not exists currency text not null default 'INR';
alter table public.room_booking_payments
  add column if not exists received_by text;
alter table public.room_booking_payments
  add column if not exists received_role text;
alter table public.room_booking_payments
  add column if not exists provider_reference text;
alter table public.room_booking_payments
  add column if not exists version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='room_booking_payments_type_check'
      and conrelid='public.room_booking_payments'::regclass
  ) then
    alter table public.room_booking_payments
      add constraint room_booking_payments_type_check check (
        payment_type in ('booking_advance','additional_advance','checkout_payment','adjustment')
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='room_booking_payments_currency_check'
      and conrelid='public.room_booking_payments'::regclass
  ) then
    alter table public.room_booking_payments
      add constraint room_booking_payments_currency_check check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

update public.room_booking_payments
set receipt_reference='AR-MIG-'||lpad(id::text,10,'0')
where receipt_reference is null and payment_status='paid';

create unique index if not exists uq_room_booking_payment_receipt_scope
  on public.room_booking_payments (hotel_slug,receipt_reference)
  where receipt_reference is not null;

create index if not exists idx_room_booking_payments_reconciliation
  on public.room_booking_payments (hotel_slug,booking_id,payment_status,paid_at desc);

create unique index if not exists uq_room_booking_payment_provider_reference
  on public.room_booking_payments (hotel_slug,payment_method,provider_reference)
  where provider_reference is not null and length(trim(provider_reference))>0;

create index if not exists idx_room_booking_payments_group
  on public.room_booking_payments (hotel_slug,payment_group_id)
  where payment_group_id is not null;

create index if not exists idx_room_bookings_payment_report
  on public.room_bookings (hotel_slug,payment_status,booking_status,created_at desc);

create or replace function public.create_room_booking_with_advance(
  p_hotel_slug text,
  p_booking jsonb,
  p_payments jsonb,
  p_idempotency_key text,
  p_actor_id text,
  p_actor_role text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_booking public.room_bookings%rowtype;
  v_existing public.room_bookings%rowtype;
  v_room public.rooms%rowtype;
  v_policy public.hotel_room_advance_policies%rowtype;
  v_line jsonb;
  v_payment public.room_booking_payments%rowtype;
  v_payments jsonb := '[]'::jsonb;
  v_payment_total numeric(14,2) := 0;
  v_minimum numeric(14,2) := 0;
  v_method text;
  v_amount numeric(14,2);
  v_group_id text;
  v_receipt_reference text;
  v_line_number integer := 0;
  v_total numeric(14,2);
  v_balance numeric(14,2);
  v_payment_status text;
begin
  if nullif(trim(coalesce(p_hotel_slug,'')),'') is null then
    raise exception using errcode='22023',message='ROOM_ADVANCE_HOTEL_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception using errcode='22023',message='ROOM_ADVANCE_IDEMPOTENCY_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_booking,'{}'::jsonb)) <> 'object' then
    raise exception using errcode='22023',message='ROOM_ADVANCE_BOOKING_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_payments,'[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023',message='ROOM_ADVANCE_PAYMENTS_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'room-booking-advance:'||p_hotel_slug||':'||coalesce(p_booking->>'room_id',''),
      0
    )
  );

  select * into v_existing
  from public.room_bookings
  where hotel_slug=p_hotel_slug
    and idempotency_key=trim(p_idempotency_key)
  for update;

  if found then
    if coalesce(v_existing.request_fingerprint,'') <>
       coalesce(p_booking->>'request_fingerprint','') then
      raise exception using errcode='P0001',message='ROOM_ADVANCE_IDEMPOTENCY_CONFLICT';
    end if;
    select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
      into v_payments
    from public.room_booking_payments p
    where p.hotel_slug=p_hotel_slug and p.booking_id=v_existing.id;
    return jsonb_build_object(
      'idempotent',true,
      'booking',to_jsonb(v_existing),
      'payments',v_payments
    );
  end if;

  select * into v_room
  from public.rooms
  where id=(p_booking->>'room_id')::bigint
    and hotel_slug=p_hotel_slug
  for update;
  if not found then
    raise exception using errcode='P0001',message='ROOM_NOT_FOUND_FOR_HOTEL';
  end if;
  if v_room.is_active=false or v_room.status in ('maintenance','inactive') then
    raise exception using errcode='P0001',message='ROOM_NOT_BOOKABLE';
  end if;

  select * into v_policy
  from public.hotel_room_advance_policies
  where hotel_slug=p_hotel_slug;
  if not found then
    v_policy.hotel_slug := p_hotel_slug;
    v_policy.advance_mode := 'optional';
    v_policy.minimum_type := 'fixed';
    v_policy.minimum_value := 0;
    v_policy.allow_zero_advance := true;
    v_policy.allow_multiple_payments := true;
    v_policy.allow_split_payments := true;
    v_policy.allow_staff_advance := false;
    v_policy.allowed_payment_methods := array['cash','upi','card','bank_transfer']::text[];
    v_policy.currency := 'INR';
  end if;

  v_total := round(greatest(0,(p_booking->>'total_amount')::numeric),2);
  if v_total <> round(
    greatest(0,(p_booking->>'room_price')::numeric)
    + greatest(0,(p_booking->>'tax_amount')::numeric)
    - greatest(0,(p_booking->>'discount_amount')::numeric),
    2
  ) then
    raise exception using errcode='22023',message='ROOM_ADVANCE_TOTAL_MISMATCH';
  end if;

  if jsonb_array_length(p_payments) > 1 and not v_policy.allow_split_payments then
    raise exception using errcode='P0001',message='ROOM_ADVANCE_SPLIT_DISABLED';
  end if;

  for v_line in select value from jsonb_array_elements(p_payments)
  loop
    v_amount := round((v_line->>'amount')::numeric,2);
    v_method := lower(trim(coalesce(v_line->>'paymentMethod','')));
    if v_amount <= 0 then
      raise exception using errcode='22023',message='ROOM_ADVANCE_AMOUNT_INVALID';
    end if;
    if not (v_method = any(v_policy.allowed_payment_methods)) then
      raise exception using errcode='P0001',message='ROOM_ADVANCE_METHOD_DISABLED';
    end if;
    v_payment_total := round(v_payment_total+v_amount,2);
  end loop;

  if v_payment_total > v_total then
    raise exception using errcode='22023',message='ROOM_ADVANCE_EXCEEDS_TOTAL';
  end if;
  if v_policy.advance_mode='disabled' and v_payment_total>0 then
    raise exception using errcode='P0001',message='ROOM_ADVANCE_DISABLED';
  end if;
  if v_policy.advance_mode='required' and v_payment_total<=0 and not v_policy.allow_zero_advance then
    raise exception using errcode='P0001',message='ROOM_ADVANCE_REQUIRED';
  end if;
  if coalesce(lower(p_actor_role),'staff') not in ('manager','owner','admin','platform_admin')
     and v_payment_total>0 and not v_policy.allow_staff_advance then
    raise exception using errcode='42501',message='ROOM_ADVANCE_STAFF_NOT_ALLOWED';
  end if;
  v_minimum := case
    when v_policy.minimum_type='percentage'
      then round(v_total*v_policy.minimum_value/100,2)
    else round(v_policy.minimum_value,2)
  end;
  if v_payment_total>0 and v_payment_total<v_minimum then
    raise exception using errcode='22023',message='ROOM_ADVANCE_MINIMUM_NOT_MET';
  end if;

  insert into public.room_bookings (
    hotel_slug,room_id,guest_name,guest_phone,guest_email,guest_id_proof,
    check_in_date,check_out_date,adults,children,total_nights,
    room_price,tax_amount,discount_amount,total_amount,advance_paid,balance_amount,
    booking_status,payment_status,booking_source,created_by_user_id,created_by_role,
    notes,rate_plan_id,pricing_snapshot,idempotency_key,tax_rule_id,tax_snapshot,
    pricing_version,guest_company_name,guest_gstin,guest_place_of_supply,
    request_fingerprint,updated_at
  ) values (
    p_hotel_slug,(p_booking->>'room_id')::bigint,p_booking->>'guest_name',
    p_booking->>'guest_phone',nullif(p_booking->>'guest_email',''),
    nullif(p_booking->>'guest_id_proof',''),(p_booking->>'check_in_date')::date,
    (p_booking->>'check_out_date')::date,(p_booking->>'adults')::integer,
    (p_booking->>'children')::integer,(p_booking->>'total_nights')::integer,
    (p_booking->>'room_price')::numeric,(p_booking->>'tax_amount')::numeric,
    (p_booking->>'discount_amount')::numeric,v_total,0,v_total,
    p_booking->>'booking_status','unpaid',p_booking->>'booking_source',
    nullif(p_actor_id,''),coalesce(nullif(p_actor_role,''),'staff'),
    coalesce(p_booking->>'notes',''),nullif(p_booking->>'rate_plan_id','')::bigint,
    coalesce(p_booking->'pricing_snapshot','{}'::jsonb),trim(p_idempotency_key),
    nullif(p_booking->>'tax_rule_id','')::bigint,
    coalesce(p_booking->'tax_snapshot','{}'::jsonb),
    coalesce(nullif(p_booking->>'pricing_version','')::integer,1),
    coalesce(p_booking->>'guest_company_name',''),
    coalesce(p_booking->>'guest_gstin',''),
    coalesce(p_booking->>'guest_place_of_supply',''),
    nullif(p_booking->>'request_fingerprint',''),now()
  ) returning * into v_booking;

  v_group_id := 'booking-advance:'||v_booking.id::text||':'||trim(p_idempotency_key);
  for v_line in select value from jsonb_array_elements(p_payments)
  loop
    v_line_number := v_line_number+1;
    v_amount := round((v_line->>'amount')::numeric,2);
    v_method := lower(trim(v_line->>'paymentMethod'));
    v_receipt_reference :=
      'AR-'||to_char(current_date,'YYYY')||'-'||lpad(v_booking.id::text,6,'0')||
      '-'||lpad(v_line_number::text,2,'0');

    insert into public.room_booking_payments (
      hotel_slug,booking_id,amount,payment_method,payment_status,transaction_id,
      notes,paid_at,idempotency_key,payment_type,payment_group_id,
      receipt_reference,currency,received_by,received_role,provider_reference,updated_at
    ) values (
      p_hotel_slug,v_booking.id,v_amount,v_method,'paid',
      nullif(v_line->>'transactionId',''),coalesce(v_line->>'notes',''),now(),
      trim(p_idempotency_key)||':'||v_line_number::text,'booking_advance',v_group_id,
      v_receipt_reference,v_policy.currency,nullif(p_actor_id,''),
      coalesce(nullif(p_actor_role,''),'staff'),nullif(v_line->>'transactionId',''),now()
    ) returning * into v_payment;
    v_payments := v_payments||jsonb_build_array(to_jsonb(v_payment));
  end loop;

  v_balance := round(greatest(0,v_total-v_payment_total),2);
  v_payment_status := case
    when v_payment_total<=0 then 'unpaid'
    when v_balance<=0 then 'paid'
    else 'partial'
  end;
  update public.room_bookings
  set advance_paid=v_payment_total,balance_amount=v_balance,
      payment_status=v_payment_status,updated_at=now()
  where id=v_booking.id and hotel_slug=p_hotel_slug
  returning * into v_booking;

  insert into public.room_operation_audit (
    hotel_slug,actor_id,actor_role,action,target_type,target_id,new_value
  ) values (
    p_hotel_slug,p_actor_id,coalesce(nullif(p_actor_role,''),'staff'),
    'room_booking_created_with_advance','room_booking',v_booking.id::text,
    jsonb_build_object(
      'advancePaid',v_payment_total,'balanceAmount',v_balance,
      'paymentStatus',v_payment_status,'paymentGroupId',v_group_id,
      'paymentLineCount',jsonb_array_length(v_payments)
    )
  );

  return jsonb_build_object(
    'idempotent',false,'booking',to_jsonb(v_booking),'payments',v_payments
  );
end $$;

create or replace function public.enforce_room_payment_hotel_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $
begin
  if not exists (
    select 1 from public.room_bookings
    where id=new.booking_id and hotel_slug=new.hotel_slug
  ) then
    raise exception using errcode='23503',message='ROOM_PAYMENT_HOTEL_SCOPE_MISMATCH';
  end if;
  return new;
end $;

drop trigger if exists trg_enforce_room_payment_hotel_scope on public.room_booking_payments;
create trigger trg_enforce_room_payment_hotel_scope
before insert or update of booking_id,hotel_slug on public.room_booking_payments
for each row execute function public.enforce_room_payment_hotel_scope();

alter table public.hotel_room_advance_policies enable row level security;
revoke all on public.hotel_room_advance_policies from public,anon,authenticated;
grant select,insert,update,delete on public.hotel_room_advance_policies to service_role;

revoke all on function public.create_room_booking_with_advance(text,jsonb,jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.create_room_booking_with_advance(text,jsonb,jsonb,text,text,text)
  to service_role;

-- Extend the existing atomic additional-payment function without changing its signature.
create or replace function public.record_room_booking_payment(
  p_hotel_slug text,p_booking_id bigint,p_amount numeric,p_payment_method text,
  p_transaction_id text,p_notes text,p_idempotency_key text,p_actor_id text,p_actor_role text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_booking room_bookings%rowtype;
  v_existing room_booking_payments%rowtype;
  v_payment room_booking_payments%rowtype;
  v_policy hotel_room_advance_policies%rowtype;
  v_ledger_paid numeric(14,2);
  v_next_paid numeric(14,2);
  v_next_balance numeric(14,2);
  v_receipt text;
begin
  if nullif(trim(p_idempotency_key),'') is null then
    raise exception using errcode='P0001',message='ROOM_PAYMENT_IDEMPOTENCY_REQUIRED';
  end if;
  select * into v_booking from public.room_bookings
   where id=p_booking_id and hotel_slug=p_hotel_slug for update;
  if not found then raise exception using errcode='P0001',message='ROOM_BOOKING_NOT_FOUND'; end if;
  select * into v_existing from public.room_booking_payments
   where hotel_slug=p_hotel_slug and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.booking_id<>p_booking_id then
      raise exception using errcode='P0001',message='ROOM_PAYMENT_IDEMPOTENCY_SCOPE_CONFLICT';
    end if;
    if round(v_existing.amount,2)<>round(p_amount,2)
       or lower(trim(v_existing.payment_method))<>lower(trim(p_payment_method))
       or coalesce(v_existing.transaction_id,'')<>coalesce(p_transaction_id,'') then
      raise exception using errcode='P0001',message='ROOM_PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('idempotent',true,'payment',to_jsonb(v_existing));
  end if;
  if v_booking.booking_status='cancelled' then
    raise exception using errcode='P0001',message='ROOM_PAYMENT_CANCELLED_BOOKING';
  end if;

  select * into v_policy from public.hotel_room_advance_policies where hotel_slug=p_hotel_slug;
  if found then
    if not lower(trim(p_payment_method))=any(v_policy.allowed_payment_methods) then
      raise exception using errcode='P0001',message='ROOM_ADVANCE_METHOD_DISABLED';
    end if;
    if not v_policy.allow_multiple_payments and exists (
      select 1 from public.room_booking_payments
      where hotel_slug=p_hotel_slug and booking_id=p_booking_id and payment_status='paid'
    ) then
      raise exception using errcode='P0001',message='ROOM_MULTIPLE_ADVANCES_DISABLED';
    end if;
  end if;

  select round(
    greatest(
      0,
      coalesce((
        select sum(amount) from public.room_booking_payments
        where hotel_slug=p_hotel_slug and booking_id=p_booking_id and payment_status='paid'
      ),0)
      - coalesce((
        select sum(amount) from public.room_booking_refunds
        where hotel_slug=p_hotel_slug and booking_id=p_booking_id and status='completed'
      ),0)
    ),
    2
  ) into v_ledger_paid;
  v_next_balance:=greatest(0,v_booking.total_amount-v_ledger_paid);
  if p_amount<=0 or p_amount>v_next_balance then
    raise exception using errcode='P0001',message='ROOM_PAYMENT_EXCEEDS_BALANCE';
  end if;
  v_receipt :=
    'AR-'||to_char(current_date,'YYYY')||'-'||lpad(p_booking_id::text,6,'0')||
    '-'||lpad((coalesce((
      select count(*) from public.room_booking_payments
      where hotel_slug=p_hotel_slug and booking_id=p_booking_id
    ),0)+1)::text,2,'0');
  insert into public.room_booking_payments(
    hotel_slug,booking_id,amount,payment_method,payment_status,transaction_id,notes,
    paid_at,idempotency_key,payment_type,payment_group_id,receipt_reference,currency,
    received_by,received_role,provider_reference,updated_at
  ) values (
    p_hotel_slug,p_booking_id,round(p_amount,2),lower(trim(p_payment_method)),'paid',
    nullif(p_transaction_id,''),coalesce(p_notes,''),now(),p_idempotency_key,
    'additional_advance','additional-advance:'||p_booking_id::text||':'||p_idempotency_key,
    v_receipt,coalesce(v_policy.currency,'INR'),nullif(p_actor_id,''),
    coalesce(nullif(p_actor_role,''),'staff'),nullif(p_transaction_id,''),now()
  ) returning * into v_payment;
  v_next_paid:=round(v_ledger_paid+p_amount,2);
  v_next_balance:=greatest(0,v_booking.total_amount-v_next_paid);
  update public.room_bookings set
    advance_paid=v_next_paid,balance_amount=v_next_balance,
    payment_status=case when v_next_balance<=0 then 'paid' else 'partial' end,
    updated_at=now()
  where id=p_booking_id and hotel_slug=p_hotel_slug;
  insert into public.room_operation_audit(
    hotel_slug,actor_id,actor_role,action,target_type,target_id,new_value
  ) values (
    p_hotel_slug,p_actor_id,coalesce(nullif(p_actor_role,''),'owner'),
    'room_payment_recorded','room_booking',p_booking_id::text,
    jsonb_build_object(
      'paymentId',v_payment.id,'amount',p_amount,'balanceAmount',v_next_balance,
      'receiptReference',v_receipt
    )
  );
  return jsonb_build_object(
    'idempotent',false,'payment',to_jsonb(v_payment),
    'advancePaid',v_next_paid,'balanceAmount',v_next_balance,
    'paymentStatus',case when v_next_balance<=0 then 'paid' else 'partial' end
  );
end $$;

revoke all on function public.record_room_booking_payment(text,bigint,numeric,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.record_room_booking_payment(text,bigint,numeric,text,text,text,text,text,text)
  to service_role;

commit;
