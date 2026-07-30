-- Dormant migration for atomic room + room-service checkout.
-- Review and test in staging before applying. The application does not call this RPC yet.
--
-- Design:
-- 1. A checkout receipt stores room/food allocation and an idempotency key.
-- 2. A room-service link trigger validates tenant/room/check-in state and locks the
--    booking row, preventing a new linked food order from racing final checkout.
-- 3. settle_room_combined_checkout locks the booking, recalculates all amounts from
--    stored backend data, records the room payment, settles eligible food orders,
--    checks the guest out, and writes one receipt in the same transaction.
-- 4. Order ids are stored in JSONB because the original orders.id SQL type is not
--    defined by this repository. No blind foreign key is added.

create table if not exists public.room_checkout_receipts (
  id bigserial primary key,
  hotel_slug text not null,
  booking_id bigint not null references public.room_bookings(id) on delete restrict,
  idempotency_key text not null,
  amount numeric(12,2) not null check (amount >= 0),
  room_amount numeric(12,2) not null default 0 check (room_amount >= 0),
  food_amount numeric(12,2) not null default 0 check (food_amount >= 0),
  currency text not null default 'INR',
  payment_method text not null,
  payment_status text not null default 'paid',
  transaction_id text,
  settled_order_ids jsonb not null default '[]'::jsonb,
  allocations_json jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_by_user_id text,
  created_by_role text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_checkout_receipts_payment_status_check check (
    payment_status in ('paid', 'refunded')
  ),
  constraint room_checkout_receipts_idempotency_length_check check (
    char_length(idempotency_key) between 8 and 200
  ),
  constraint room_checkout_receipts_payment_method_length_check check (
    char_length(payment_method) between 1 and 80
  ),
  constraint room_checkout_receipts_transaction_length_check check (
    transaction_id is null or char_length(transaction_id) <= 200
  ),
  constraint room_checkout_receipts_allocation_check check (
    amount = room_amount + food_amount
  ),
  constraint room_checkout_receipts_order_ids_array_check check (
    jsonb_typeof(settled_order_ids) = 'array'
  ),
  constraint room_checkout_receipts_allocations_array_check check (
    jsonb_typeof(allocations_json) = 'array'
  ),
  constraint room_checkout_receipts_hotel_idempotency_unique unique (
    hotel_slug,
    idempotency_key
  )
);

comment on table public.room_checkout_receipts is
  'Immutable receipt header for one atomic room and room-service checkout settlement.';

comment on column public.room_checkout_receipts.idempotency_key is
  'Backend-generated retry key. Reusing the same key returns the original receipt.';

comment on column public.room_checkout_receipts.allocations_json is
  'Snapshot of settled food order ids and backend-calculated amounts.';

create index if not exists idx_room_checkout_receipts_hotel_booking
  on public.room_checkout_receipts (hotel_slug, booking_id, created_at desc);

create index if not exists idx_room_checkout_receipts_transaction
  on public.room_checkout_receipts (hotel_slug, transaction_id)
  where transaction_id is not null;

create or replace function public.room_checkout_safe_numeric(p_value text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when trim(coalesce(p_value, '')) ~ '^-?[0-9]+([.][0-9]+)?$'
      then p_value::numeric
    else null
  end;
$$;

create or replace function public.room_checkout_order_total(
  p_totals jsonb,
  p_items jsonb
)
returns numeric
language sql
immutable
parallel safe
as $$
  select round(
    coalesce(
      public.room_checkout_safe_numeric(p_totals ->> 'gpayFinalTotal'),
      public.room_checkout_safe_numeric(p_totals ->> 'final'),
      public.room_checkout_safe_numeric(p_totals ->> 'total'),
      public.room_checkout_safe_numeric(p_totals ->> 'normalTotal'),
      (
        select coalesce(sum(
          coalesce(public.room_checkout_safe_numeric(item ->> 'qty'), 0) *
          coalesce(public.room_checkout_safe_numeric(item ->> 'price'), 0)
        ), 0)
        from jsonb_array_elements(
          case
            when jsonb_typeof(p_items) = 'array' then p_items
            else '[]'::jsonb
          end
        ) as item
      ),
      0
    ),
    2
  );
$$;

create or replace function public.validate_room_service_booking_link()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_booking public.room_bookings%rowtype;
begin
  if new.room_booking_id is null then
    return new;
  end if;

  select *
    into v_booking
  from public.room_bookings
  where id = new.room_booking_id
  for key share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Linked room booking was not found';
  end if;

  if new.hotel_slug is distinct from v_booking.hotel_slug then
    raise exception using
      errcode = '23514',
      message = 'Room service order hotel does not match the booking';
  end if;

  if new.room_id is distinct from v_booking.room_id then
    raise exception using
      errcode = '23514',
      message = 'Room service order room does not match the booking';
  end if;

  if v_booking.booking_status <> 'checked_in' then
    raise exception using
      errcode = '23514',
      message = 'Room service orders require a checked-in booking';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_validate_room_service_booking_link on public.orders;

create trigger orders_validate_room_service_booking_link
before insert or update of hotel_slug, room_id, room_booking_id, room_service_charge_to_room
on public.orders
for each row
when (new.room_booking_id is not null)
execute function public.validate_room_service_booking_link();

create or replace function public.settle_room_combined_checkout(
  p_hotel_slug text,
  p_booking_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_transaction_id text default null,
  p_notes text default '',
  p_created_by_user_id text default null,
  p_created_by_role text default null,
  p_idempotency_key text default null,
  p_currency text default 'INR'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.room_bookings%rowtype;
  v_existing_receipt public.room_checkout_receipts%rowtype;
  v_receipt public.room_checkout_receipts%rowtype;
  v_room_due numeric(12,2);
  v_food_due numeric(12,2);
  v_final_due numeric(12,2);
  v_requested_amount numeric(12,2);
  v_allocations jsonb := '[]'::jsonb;
  v_order_ids jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_updated_order_count integer := 0;
begin
  if nullif(trim(coalesce(p_hotel_slug, '')), '') is null then
    raise exception using errcode = '22023', message = 'Hotel scope is required';
  end if;

  if nullif(trim(coalesce(p_payment_method, '')), '') is null then
    raise exception using errcode = '22023', message = 'Payment method is required';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'Idempotency key is required';
  end if;

  if char_length(trim(p_idempotency_key)) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'Idempotency key must be 8 to 200 characters';
  end if;

  if char_length(trim(p_payment_method)) > 80 then
    raise exception using errcode = '22023', message = 'Payment method is too long';
  end if;

  if char_length(trim(coalesce(p_transaction_id, ''))) > 200 then
    raise exception using errcode = '22023', message = 'Transaction id is too long';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception using errcode = '22023', message = 'Checkout amount cannot be negative';
  end if;

  select *
    into v_booking
  from public.room_bookings
  where id = p_booking_id
    and hotel_slug = trim(p_hotel_slug)
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Room booking not found for this hotel';
  end if;

  select *
    into v_existing_receipt
  from public.room_checkout_receipts
  where hotel_slug = v_booking.hotel_slug
    and idempotency_key = trim(p_idempotency_key)
  limit 1;

  if found then
    if v_existing_receipt.booking_id <> v_booking.id then
      raise exception using errcode = '23505', message = 'Idempotency key belongs to another booking';
    end if;

    return jsonb_build_object(
      'idempotentReplay', true,
      'receipt', to_jsonb(v_existing_receipt),
      'booking', to_jsonb(v_booking)
    );
  end if;

  if v_booking.booking_status <> 'checked_in' then
    raise exception using errcode = '23514', message = 'Only checked-in bookings can be checked out';
  end if;

  v_room_due := round(greatest(
    0,
    coalesce(v_booking.balance_amount, v_booking.total_amount - v_booking.advance_paid, 0)
  ), 2);

  select
    coalesce(sum(eligible.amount), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'orderId', eligible.id::text,
        'amount', eligible.amount
      )
      order by eligible.created_at, eligible.id::text
    ), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(eligible.id::text) order by eligible.created_at, eligible.id::text), '[]'::jsonb)
  into v_food_due, v_allocations, v_order_ids
  from (
    select
      orders.id,
      orders.created_at,
      greatest(
        0,
        public.room_checkout_order_total(
          to_jsonb(orders.totals),
          to_jsonb(orders.items)
        )
      ) as amount
    from public.orders
    where orders.hotel_slug = v_booking.hotel_slug
      and orders.room_booking_id = v_booking.id
      and orders.room_service_charge_to_room is true
      and lower(coalesce(orders.status, 'new')) not in ('cancelled', 'payment_failed')
      and lower(coalesce(orders.payment_status, 'unpaid')) not in ('paid', 'refunded')
    for update
  ) as eligible;

  v_food_due := round(greatest(0, coalesce(v_food_due, 0)), 2);
  v_final_due := round(v_room_due + v_food_due, 2);
  v_requested_amount := round(p_amount, 2);

  if v_requested_amount <> v_final_due then
    raise exception using
      errcode = '22023',
      message = format(
        'Checkout amount does not match backend total. Expected %s',
        v_final_due
      );
  end if;

  if v_room_due > 0 then
    insert into public.room_booking_payments (
      hotel_slug,
      booking_id,
      amount,
      payment_method,
      payment_status,
      transaction_id,
      notes,
      paid_at,
      updated_at
    ) values (
      v_booking.hotel_slug,
      v_booking.id,
      v_room_due,
      trim(p_payment_method),
      'paid',
      nullif(trim(coalesce(p_transaction_id, '')), ''),
      left(coalesce(p_notes, ''), 1000),
      v_now,
      v_now
    );
  end if;

  update public.orders as target
  set
    payment_status = 'paid',
    billing_status = 'billed',
    paid_at = coalesce(target.paid_at, v_now),
    billed_at = coalesce(target.billed_at, v_now),
    bill_number = coalesce(
      nullif(target.bill_number, ''),
      concat(
        'BILL-',
        left(
          trim(both '-' from regexp_replace(
            upper(coalesce(target.hotel_slug, 'HOTEL')),
            '[^A-Z0-9]+',
            '-',
            'g'
          )),
          18
        ),
        '-',
        to_char(v_now at time zone 'UTC', 'YYYYMMDD'),
        '-',
        right(regexp_replace(upper(target.id::text), '[^A-Z0-9]', '', 'g'), 8)
      )
    )
  where target.hotel_slug = v_booking.hotel_slug
    and target.room_booking_id = v_booking.id
    and target.room_service_charge_to_room is true
    and lower(coalesce(target.status, 'new')) not in ('cancelled', 'payment_failed')
    and lower(coalesce(target.payment_status, 'unpaid')) not in ('paid', 'refunded');

  get diagnostics v_updated_order_count = row_count;

  if v_updated_order_count <> jsonb_array_length(v_order_ids) then
    raise exception using
      errcode = '40001',
      message = 'Room service orders changed during checkout; retry with a new summary';
  end if;

  update public.room_bookings
  set
    advance_paid = total_amount,
    balance_amount = 0,
    payment_status = 'paid',
    booking_status = 'checked_out',
    checked_out_at = coalesce(checked_out_at, v_now),
    updated_at = v_now
  where id = v_booking.id
    and hotel_slug = v_booking.hotel_slug
  returning * into v_booking;

  insert into public.room_checkout_receipts (
    hotel_slug,
    booking_id,
    idempotency_key,
    amount,
    room_amount,
    food_amount,
    currency,
    payment_method,
    payment_status,
    transaction_id,
    settled_order_ids,
    allocations_json,
    notes,
    created_by_user_id,
    created_by_role,
    paid_at,
    updated_at
  ) values (
    v_booking.hotel_slug,
    v_booking.id,
    trim(p_idempotency_key),
    v_final_due,
    v_room_due,
    v_food_due,
    upper(left(trim(coalesce(p_currency, 'INR')), 8)),
    trim(p_payment_method),
    'paid',
    nullif(trim(coalesce(p_transaction_id, '')), ''),
    v_order_ids,
    v_allocations,
    left(coalesce(p_notes, ''), 2000),
    nullif(trim(coalesce(p_created_by_user_id, '')), ''),
    nullif(trim(coalesce(p_created_by_role, '')), ''),
    v_now,
    v_now
  )
  returning * into v_receipt;

  return jsonb_build_object(
    'idempotentReplay', false,
    'receipt', to_jsonb(v_receipt),
    'booking', to_jsonb(v_booking),
    'settledOrderCount', v_updated_order_count
  );
end;
$$;

revoke all on function public.room_checkout_safe_numeric(text)
  from public, anon, authenticated;
revoke all on function public.room_checkout_order_total(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.validate_room_service_booking_link()
  from public, anon, authenticated;
revoke all on function public.settle_room_combined_checkout(
  text,
  bigint,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.room_checkout_safe_numeric(text)
  to service_role;
grant execute on function public.room_checkout_order_total(jsonb, jsonb)
  to service_role;
grant execute on function public.validate_room_service_booking_link()
  to service_role;
grant execute on function public.settle_room_combined_checkout(
  text,
  bigint,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;
