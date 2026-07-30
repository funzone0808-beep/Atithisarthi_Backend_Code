-- Production Room pricing, GST and refund hardening.
-- Apply after create-room-booking-tables.sql, upgrade-professional-room-operations.sql
-- and create-room-checkout-thermal-bill.sql.

begin;

create table if not exists public.hotel_room_tax_settings (
  hotel_slug text primary key,
  is_configured boolean not null default false,
  gst_enabled boolean not null default false,
  gst_registered boolean not null default false,
  gstin text not null default '',
  legal_business_name text not null default '',
  state_name text not null default '',
  state_code text not null default '',
  place_of_supply text not null default '',
  accommodation_sac text not null default '',
  default_tax_mode text not null default 'exclusive' check (default_tax_mode in ('inclusive','exclusive')),
  default_supply_type text not null default 'intrastate' check (default_supply_type in ('intrastate','interstate')),
  invoice_type text not null default 'guest_folio' check (invoice_type in ('tax_invoice','guest_folio','receipt')),
  rounding_rule text not null default 'half_up' check (rounding_rule in ('half_up','nearest_rupee','none')),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  version integer not null default 1 check (version > 0),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_room_tax_settings_gstin_check check (
    not gst_registered or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  constraint hotel_room_tax_settings_enabled_check check (not gst_enabled or gst_registered)
);

create table if not exists public.room_tax_rules (
  id bigserial primary key,
  hotel_slug text not null,
  rule_name text not null,
  accommodation_category text not null default 'room_accommodation',
  calculation_basis text not null default 'transaction_value'
    check (calculation_basis in ('transaction_value','configured_taxable_value')),
  minimum_taxable_value numeric(14,2) not null default 0 check (minimum_taxable_value >= 0),
  maximum_taxable_value numeric(14,2) check (maximum_taxable_value is null or maximum_taxable_value >= minimum_taxable_value),
  cgst_rate numeric(7,4) not null default 0 check (cgst_rate between 0 and 100),
  sgst_rate numeric(7,4) not null default 0 check (sgst_rate between 0 and 100),
  igst_rate numeric(7,4) not null default 0 check (igst_rate between 0 and 100),
  cess_rate numeric(7,4) not null default 0 check (cess_rate between 0 and 100),
  is_exempt boolean not null default false,
  exemption_reason text not null default '',
  tax_inclusive boolean not null default false,
  effective_from date not null,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  version integer not null default 1 check (version > 0),
  created_by text,
  approved_by text,
  approved_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_tax_rules_dates_check check (effective_to is null or effective_to >= effective_from),
  constraint room_tax_rules_exemption_check check (
    not is_exempt or (
      cgst_rate=0 and sgst_rate=0 and igst_rate=0 and cess_rate=0 and length(trim(exemption_reason))>0
    )
  )
);

alter table public.room_tax_rules add column if not exists is_exempt boolean not null default false;
alter table public.room_tax_rules add column if not exists exemption_reason text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='hotel_room_tax_settings_enabled_check' and conrelid='public.hotel_room_tax_settings'::regclass) then
    alter table public.hotel_room_tax_settings
      add constraint hotel_room_tax_settings_enabled_check check (not gst_enabled or gst_registered);
  end if;
  if not exists (select 1 from pg_constraint where conname='hotel_room_tax_settings_gstin_format_check' and conrelid='public.hotel_room_tax_settings'::regclass) then
    alter table public.hotel_room_tax_settings add constraint hotel_room_tax_settings_gstin_format_check check (
      not gst_registered or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
    );
  end if;
  if not exists (select 1 from pg_constraint where conname='room_tax_rules_exemption_check' and conrelid='public.room_tax_rules'::regclass) then
    alter table public.room_tax_rules add constraint room_tax_rules_exemption_check check (
      not is_exempt or (
        cgst_rate=0 and sgst_rate=0 and igst_rate=0 and cess_rate=0 and length(trim(exemption_reason))>0
      )
    );
  end if;
end $$;

create index if not exists idx_room_tax_rules_scope_effective
  on public.room_tax_rules (hotel_slug, status, effective_from, effective_to);

alter table public.room_bookings add column if not exists tax_rule_id bigint references public.room_tax_rules(id) on delete set null;
alter table public.room_bookings add column if not exists tax_snapshot jsonb not null default '{}'::jsonb;
alter table public.room_bookings add column if not exists pricing_version integer not null default 1 check (pricing_version > 0);
alter table public.room_bookings add column if not exists guest_company_name text not null default '';
alter table public.room_bookings add column if not exists guest_gstin text not null default '';
alter table public.room_bookings add column if not exists guest_place_of_supply text not null default '';
alter table public.room_booking_payments add column if not exists idempotency_key text;

create unique index if not exists uq_room_booking_payments_scope_idempotency
  on public.room_booking_payments (hotel_slug,idempotency_key)
  where idempotency_key is not null;

alter table public.room_rate_plans add column if not exists room_id bigint references public.rooms(id) on delete restrict;
alter table public.room_rate_plans add column if not exists status text not null default 'active'
  check (status in ('draft','active','retired'));
alter table public.room_rate_plans add column if not exists version integer not null default 1 check (version > 0);
alter table public.room_rate_plans add column if not exists approved_by text;
alter table public.room_rate_plans add column if not exists approved_at timestamptz;
alter table public.room_rate_plans add column if not exists retired_at timestamptz;
update public.room_rate_plans
set status='retired',retired_at=coalesce(retired_at,now())
where is_active=false and status='active' and approved_at is null;

create index if not exists idx_room_rate_plans_effective_target
  on public.room_rate_plans (hotel_slug, room_id, room_type_id, status, start_date, end_date, priority desc);

create table if not exists public.room_booking_refunds (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null,
  transaction_id text,
  reason text not null,
  status text not null default 'completed' check (status in ('pending','completed','failed','cancelled')),
  idempotency_key text not null,
  tax_adjustment_snapshot jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  constraint room_booking_refunds_scope_idempotency unique (hotel_slug,idempotency_key)
);

create index if not exists idx_room_booking_refunds_scope_booking
  on public.room_booking_refunds (hotel_slug,booking_id,created_at desc);

create table if not exists public.room_stay_rate_adjustments (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in ('extension','authorized_rate_adjustment')),
  effective_from date not null,
  effective_to date not null,
  nights integer not null check (nights > 0),
  base_amount numeric(14,2) not null check (base_amount >= 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  tax_snapshot jsonb not null default '{}'::jsonb,
  reason text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint room_stay_rate_adjustments_dates_check check (effective_to > effective_from)
);

create index if not exists idx_room_stay_rate_adjustments_scope_booking
  on public.room_stay_rate_adjustments (hotel_slug,booking_id,created_at);

create or replace function public.lock_room_booking_financial_scope()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_type_id bigint;
begin
  select room_type_id into v_type_id from public.rooms
   where id=new.room_id and hotel_slug=new.hotel_slug;
  if not found then
    raise exception using errcode='P0001',message='ROOM_BOOKING_HOTEL_SCOPE_MISMATCH';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug,0));
  perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug||':room:'||new.room_id,0));
  if v_type_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug||':type:'||v_type_id,0));
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_room_booking_financial_scope on public.room_bookings;
create trigger trg_lock_room_booking_financial_scope
before insert or update of room_id,check_in_date,check_out_date,booking_status on public.room_bookings
for each row execute function public.lock_room_booking_financial_scope();

create or replace function public.protect_room_booking_snapshots()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.pricing_snapshot is distinct from old.pricing_snapshot or
     new.tax_snapshot is distinct from old.tax_snapshot or
     new.pricing_version is distinct from old.pricing_version or
     new.tax_rule_id is distinct from old.tax_rule_id then
    raise exception using errcode='23514', message='ROOM_BOOKING_FINANCIAL_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_room_booking_snapshots on public.room_bookings;
create trigger trg_protect_room_booking_snapshots
before update on public.room_bookings
for each row execute function public.protect_room_booking_snapshots();

create or replace function public.protect_room_master_financial_change()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug,0));
  perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug||':room:'||new.id,0));
  if old.room_type_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug||':type:'||old.room_type_id,0));
  end if;
  if (new.base_price,new.discount_price,new.tax_percent,new.room_type_id,new.floor_id)
     is distinct from
     (old.base_price,old.discount_price,old.tax_percent,old.room_type_id,old.floor_id)
     and exists (
       select 1 from public.room_bookings b
       where b.hotel_slug=new.hotel_slug and b.room_id=new.id
         and b.booking_status in ('pending','confirmed','checked_in')
         and b.check_out_date > current_date
     ) then
    raise exception using errcode='P0001', message='ROOM_PRICE_PERIOD_CONFLICT';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_room_master_financial_change on public.rooms;
create trigger trg_protect_room_master_financial_change
before update on public.rooms for each row execute function public.protect_room_master_financial_change();

create or replace function public.protect_room_type_financial_change()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug,0));
  perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug||':type:'||new.id,0));
  if (new.base_price,new.extra_adult_rate,new.extra_child_rate)
     is distinct from (old.base_price,old.extra_adult_rate,old.extra_child_rate)
     and exists (
       select 1 from public.room_bookings b join public.rooms r on r.id=b.room_id
       where b.hotel_slug=new.hotel_slug and r.hotel_slug=new.hotel_slug and r.room_type_id=new.id
         and b.booking_status in ('pending','confirmed','checked_in')
         and b.check_out_date > current_date
     ) then
    raise exception using errcode='P0001', message='ROOM_TYPE_PRICE_PERIOD_CONFLICT';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_room_type_financial_change on public.room_types;
create trigger trg_protect_room_type_financial_change
before update on public.room_types for each row execute function public.protect_room_type_financial_change();

create or replace function public.protect_room_rate_plan_change()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_start date; v_end date;
begin
  v_start:=coalesce(new.start_date,current_date); v_end:=coalesce(new.end_date,'infinity'::date);
  if new.room_id is not null and not exists (
    select 1 from public.rooms r where r.id=new.room_id and r.hotel_slug=new.hotel_slug
  ) then raise exception using errcode='P0001',message='ROOM_RATE_ROOM_SCOPE_MISMATCH'; end if;
  if new.room_type_id is not null and not exists (
    select 1 from public.room_types rt where rt.id=new.room_type_id and rt.hotel_slug=new.hotel_slug
  ) then raise exception using errcode='P0001',message='ROOM_RATE_TYPE_SCOPE_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug,0));
  if new.room_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug||':room:'||new.room_id,0));
  elsif new.room_type_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('room-finance:'||new.hotel_slug||':type:'||new.room_type_id,0));
  end if;
  if new.status='active' and new.is_active then
    if exists (
      select 1 from public.room_rate_plans p
      where p.hotel_slug=new.hotel_slug and p.id<>coalesce(new.id,0)
        and p.status='active' and p.is_active
        and p.room_id is not distinct from new.room_id
        and p.room_type_id is not distinct from new.room_type_id
        and daterange(coalesce(p.start_date,'-infinity'::date),coalesce(p.end_date,'infinity'::date),'[]') &&
            daterange(v_start,v_end,'[]')
    ) then raise exception using errcode='23P01',message='ROOM_RATE_PLAN_OVERLAP'; end if;
    if exists (
      select 1 from public.room_bookings b join public.rooms r on r.id=b.room_id and r.hotel_slug=b.hotel_slug
      where b.hotel_slug=new.hotel_slug and b.booking_status in ('pending','confirmed','checked_in')
        and b.check_in_date <= v_end and b.check_out_date > v_start
        and (new.room_id is null or b.room_id=new.room_id)
        and (new.room_type_id is null or r.room_type_id=new.room_type_id)
    ) then raise exception using errcode='P0001',message='ROOM_RATE_BOOKING_CONFLICT'; end if;
  end if;
  if tg_op='UPDATE' then new.version:=old.version+1; end if;
  return new;
end $$;

drop trigger if exists trg_protect_room_rate_plan_change on public.room_rate_plans;
create trigger trg_protect_room_rate_plan_change
before insert or update on public.room_rate_plans
for each row execute function public.protect_room_rate_plan_change();

create or replace function public.activate_room_tax_rule(
  p_hotel_slug text,p_rule_id bigint,p_expected_version integer,p_actor_id text
) returns room_tax_rules language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rule room_tax_rules%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('room-tax:'||p_hotel_slug,0));
  select * into v_rule from public.room_tax_rules
   where id=p_rule_id and hotel_slug=p_hotel_slug for update;
  if not found then raise exception using errcode='P0001',message='ROOM_TAX_RULE_NOT_FOUND'; end if;
  if v_rule.version<>p_expected_version then raise exception using errcode='P0001',message='ROOM_TAX_RULE_CHANGED'; end if;
  if exists (
    select 1 from public.room_tax_rules r where r.hotel_slug=p_hotel_slug and r.id<>p_rule_id and r.status='active'
      and daterange(r.effective_from,coalesce(r.effective_to,'infinity'::date),'[]') &&
          daterange(v_rule.effective_from,coalesce(v_rule.effective_to,'infinity'::date),'[]')
      and numrange(r.minimum_taxable_value,r.maximum_taxable_value,'[]') &&
          numrange(v_rule.minimum_taxable_value,v_rule.maximum_taxable_value,'[]')
  ) then raise exception using errcode='23P01',message='ROOM_TAX_RULE_OVERLAP'; end if;
  update public.room_tax_rules set status='active',approved_by=p_actor_id,approved_at=now(),
    version=version+1,updated_at=now() where id=p_rule_id and hotel_slug=p_hotel_slug returning * into v_rule;
  insert into public.room_operation_audit(hotel_slug,actor_id,actor_role,action,target_type,target_id,new_value)
  values(p_hotel_slug,p_actor_id,'owner','room_tax_rule_activated','room_tax_rule',p_rule_id::text,to_jsonb(v_rule));
  return v_rule;
end $$;

create or replace function public.record_room_booking_payment(
  p_hotel_slug text,p_booking_id bigint,p_amount numeric,p_payment_method text,
  p_transaction_id text,p_notes text,p_idempotency_key text,p_actor_id text,p_actor_role text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_booking room_bookings%rowtype; v_existing room_booking_payments%rowtype;
  v_payment room_booking_payments%rowtype; v_next_paid numeric(14,2); v_next_balance numeric(14,2);
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
    return jsonb_build_object('idempotent',true,'payment',to_jsonb(v_existing));
  end if;
  if v_booking.booking_status='cancelled' then
    raise exception using errcode='P0001',message='ROOM_PAYMENT_CANCELLED_BOOKING';
  end if;
  v_next_balance:=greatest(0,v_booking.total_amount-v_booking.advance_paid);
  if p_amount<=0 or p_amount>v_next_balance then
    raise exception using errcode='P0001',message='ROOM_PAYMENT_EXCEEDS_BALANCE';
  end if;
  insert into public.room_booking_payments(
    hotel_slug,booking_id,amount,payment_method,payment_status,transaction_id,notes,
    paid_at,idempotency_key,updated_at
  ) values (
    p_hotel_slug,p_booking_id,p_amount,p_payment_method,'paid',nullif(p_transaction_id,''),
    coalesce(p_notes,''),now(),p_idempotency_key,now()
  ) returning * into v_payment;
  v_next_paid:=least(v_booking.total_amount,v_booking.advance_paid+p_amount);
  v_next_balance:=greatest(0,v_booking.total_amount-v_next_paid);
  update public.room_bookings set
    advance_paid=v_next_paid,
    balance_amount=v_next_balance,
    payment_status=case when v_next_balance<=0 then 'paid' else 'partial' end,
    updated_at=now()
  where id=p_booking_id and hotel_slug=p_hotel_slug;
  insert into public.room_operation_audit(
    hotel_slug,actor_id,actor_role,action,target_type,target_id,new_value
  ) values (
    p_hotel_slug,p_actor_id,coalesce(nullif(p_actor_role,''),'owner'),
    'room_payment_recorded','room_booking',p_booking_id::text,
    jsonb_build_object('paymentId',v_payment.id,'amount',p_amount,'balanceAmount',v_next_balance)
  );
  return jsonb_build_object(
    'idempotent',false,'payment',to_jsonb(v_payment),
    'advancePaid',v_next_paid,'balanceAmount',v_next_balance,
    'paymentStatus',case when v_next_balance<=0 then 'paid' else 'partial' end
  );
end $$;

create or replace function public.extend_room_booking(
  p_hotel_slug text,p_booking_id bigint,p_new_check_out date,
  p_actor_id text,p_actor_role text,p_reason text default ''
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_booking room_bookings%rowtype; v_additional_nights integer; v_total_nights integer;
  v_nightly numeric(14,4); v_additional_base numeric(14,2); v_tax_ratio numeric(18,8);
  v_additional_tax numeric(14,2); v_additional_total numeric(14,2);
  v_room_price numeric(14,2); v_tax numeric(14,2); v_total numeric(14,2); v_balance numeric(14,2);
begin
  select * into v_booking from public.room_bookings
   where id=p_booking_id and hotel_slug=p_hotel_slug for update;
  if not found or v_booking.booking_status not in ('confirmed','checked_in') then
    raise exception using errcode='P0001',message='ACTIVE_BOOKING_REQUIRED';
  end if;
  if p_new_check_out<=v_booking.check_out_date then
    raise exception using errcode='P0001',message='NEW_CHECKOUT_MUST_BE_LATER';
  end if;
  perform 1 from public.rooms where id=v_booking.room_id and hotel_slug=p_hotel_slug for update;
  if exists (
    select 1 from public.room_bookings b
    where b.hotel_slug=p_hotel_slug and b.room_id=v_booking.room_id and b.id<>v_booking.id
      and b.booking_status in ('pending','confirmed','checked_in')
      and b.check_in_date<p_new_check_out and b.check_out_date>v_booking.check_out_date
  ) then raise exception using errcode='23P01',message='ROOM_ALREADY_BOOKED'; end if;
  v_additional_nights:=p_new_check_out-v_booking.check_out_date;
  v_total_nights:=v_booking.total_nights+v_additional_nights;
  v_nightly:=case when v_booking.total_nights>0 then v_booking.room_price/v_booking.total_nights else 0 end;
  v_additional_base:=round(v_nightly*v_additional_nights,2);
  v_tax_ratio:=case when v_booking.room_price>0 then v_booking.tax_amount/v_booking.room_price else 0 end;
  v_additional_tax:=round(v_additional_base*v_tax_ratio,2);
  v_additional_total:=v_additional_base+v_additional_tax;
  v_room_price:=v_booking.room_price+v_additional_base;
  v_tax:=v_booking.tax_amount+v_additional_tax;
  v_total:=v_booking.total_amount+v_additional_total;
  v_balance:=greatest(0,v_total-v_booking.advance_paid);
  insert into public.room_stay_rate_adjustments(
    hotel_slug,booking_id,adjustment_type,effective_from,effective_to,nights,
    base_amount,tax_amount,total_amount,tax_snapshot,reason,created_by
  ) values (
    p_hotel_slug,v_booking.id,'extension',v_booking.check_out_date,p_new_check_out,
    v_additional_nights,v_additional_base,v_additional_tax,v_additional_total,
    jsonb_build_object(
      'sourceTaxSnapshot',v_booking.tax_snapshot,
      'sourcePricingSnapshot',v_booking.pricing_snapshot,
      'proportionalTaxRate',v_tax_ratio
    ),coalesce(p_reason,''),p_actor_id
  );
  update public.room_bookings set
    check_out_date=p_new_check_out,total_nights=v_total_nights,room_price=v_room_price,
    tax_amount=v_tax,total_amount=v_total,balance_amount=v_balance,
    payment_status=case when v_balance<=0 then 'paid' when advance_paid>0 then 'partial' else 'unpaid' end,
    updated_at=now()
  where id=v_booking.id and hotel_slug=p_hotel_slug;
  update public.guest_stays set expected_check_out_at=p_new_check_out::timestamptz,updated_at=now()
  where booking_id=v_booking.id and hotel_slug=p_hotel_slug and stay_status='checked_in';
  insert into public.room_operation_audit(
    hotel_slug,actor_id,actor_role,action,target_type,target_id,old_value,new_value,reason
  ) values (
    p_hotel_slug,p_actor_id,p_actor_role,'stay_extended','room_booking',v_booking.id::text,
    jsonb_build_object('checkOutDate',v_booking.check_out_date,'totalAmount',v_booking.total_amount),
    jsonb_build_object(
      'checkOutDate',p_new_check_out,'totalAmount',v_total,
      'additionalBase',v_additional_base,'additionalTax',v_additional_tax
    ),coalesce(p_reason,'')
  );
  return jsonb_build_object(
    'bookingId',v_booking.id,'checkOutDate',p_new_check_out,'totalNights',v_total_nights,
    'additionalBase',v_additional_base,'additionalTax',v_additional_tax,
    'totalAmount',v_total,'balanceAmount',v_balance
  );
end $$;

create or replace function public.record_room_booking_refund(
  p_hotel_slug text,p_booking_id bigint,p_amount numeric,p_payment_method text,
  p_transaction_id text,p_reason text,p_idempotency_key text,p_actor_id text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_booking room_bookings%rowtype; v_existing room_booking_refunds%rowtype;
  v_refund room_booking_refunds%rowtype; v_next_paid numeric(14,2);
begin
  if nullif(trim(p_idempotency_key),'') is null then
    raise exception using errcode='P0001',message='ROOM_REFUND_IDEMPOTENCY_REQUIRED';
  end if;
  select * into v_booking from public.room_bookings
   where id=p_booking_id and hotel_slug=p_hotel_slug for update;
  if not found then raise exception using errcode='P0001',message='ROOM_BOOKING_NOT_FOUND'; end if;
  select * into v_existing from public.room_booking_refunds
   where hotel_slug=p_hotel_slug and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.booking_id<>p_booking_id then
      raise exception using errcode='P0001',message='ROOM_REFUND_IDEMPOTENCY_SCOPE_CONFLICT';
    end if;
    return jsonb_build_object('idempotent',true,'refund',to_jsonb(v_existing));
  end if;
  if p_amount<=0 or p_amount>greatest(0,v_booking.advance_paid) then
    raise exception using errcode='P0001',message='ROOM_REFUND_EXCEEDS_PAID_AMOUNT';
  end if;
  insert into public.room_booking_refunds(hotel_slug,booking_id,amount,payment_method,transaction_id,
    reason,idempotency_key,tax_adjustment_snapshot,created_by)
  values(p_hotel_slug,p_booking_id,p_amount,p_payment_method,nullif(p_transaction_id,''),p_reason,
    p_idempotency_key,jsonb_build_object('originalTaxSnapshot',v_booking.tax_snapshot,
      'refundRatio',case when v_booking.total_amount>0 then p_amount/v_booking.total_amount else 0 end),p_actor_id)
  returning * into v_refund;
  v_next_paid:=greatest(0,v_booking.advance_paid-p_amount);
  update public.room_bookings set advance_paid=v_next_paid,
    balance_amount=greatest(0,total_amount-v_next_paid),
    payment_status=case when v_next_paid<=0 then 'refunded' when v_next_paid<total_amount then 'partial' else 'paid' end,
    updated_at=now() where id=p_booking_id and hotel_slug=p_hotel_slug;
  insert into public.room_operation_audit(hotel_slug,actor_id,actor_role,action,target_type,target_id,new_value,reason)
  values(p_hotel_slug,p_actor_id,'owner','room_refund_recorded','room_booking',p_booking_id::text,
    jsonb_build_object('refundId',v_refund.id,'amount',p_amount),p_reason);
  return jsonb_build_object('idempotent',false,'refund',to_jsonb(v_refund),'advancePaid',v_next_paid,
    'balanceAmount',greatest(0,v_booking.total_amount-v_next_paid));
end $$;

revoke all on function public.activate_room_tax_rule(text,bigint,integer,text) from public,anon,authenticated;
revoke all on function public.record_room_booking_payment(text,bigint,numeric,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_room_booking_refund(text,bigint,numeric,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.extend_room_booking(text,bigint,date,text,text,text) from public,anon,authenticated;
grant execute on function public.activate_room_tax_rule(text,bigint,integer,text) to service_role;
grant execute on function public.record_room_booking_payment(text,bigint,numeric,text,text,text,text,text,text) to service_role;
grant execute on function public.record_room_booking_refund(text,bigint,numeric,text,text,text,text,text) to service_role;
grant execute on function public.extend_room_booking(text,bigint,date,text,text,text) to service_role;

alter table public.hotel_room_tax_settings enable row level security;
alter table public.room_tax_rules enable row level security;
alter table public.room_booking_refunds enable row level security;
alter table public.room_stay_rate_adjustments enable row level security;
revoke all on public.hotel_room_tax_settings,public.room_tax_rules,public.room_booking_refunds,public.room_stay_rate_adjustments from anon,authenticated;
grant select,insert,update,delete on public.hotel_room_tax_settings,public.room_tax_rules,public.room_booking_refunds,public.room_stay_rate_adjustments to service_role;
grant usage,select on sequence public.room_tax_rules_id_seq,public.room_booking_refunds_id_seq,public.room_stay_rate_adjustments_id_seq to service_role;

notify pgrst,'reload schema';
commit;
