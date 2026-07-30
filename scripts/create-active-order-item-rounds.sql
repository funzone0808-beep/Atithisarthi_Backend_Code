-- Adds same-order item-addition rounds for active dine-in orders.
-- Apply after the existing order table-context, billing, kitchen-status,
-- staff-attribution, and active-table-guard migrations.

alter table public.orders
  add column if not exists order_version bigint not null default 1,
  add column if not exists last_item_added_at timestamptz;

create table if not exists public.order_rounds (
  id bigserial primary key,
  hotel_slug text not null,
  order_id text not null,
  sequence_number integer not null check (sequence_number >= 2),
  kot_reference text not null,
  source text not null default 'staff',
  status text not null default 'new'
    check (status in ('new', 'accepted', 'preparing', 'ready', 'served', 'delayed', 'cancelled')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  totals_delta jsonb not null default '{}'::jsonb check (jsonb_typeof(totals_delta) = 'object'),
  note text,
  idempotency_key text not null,
  request_fingerprint text not null,
  created_by_staff_id bigint,
  created_by_role text,
  created_at timestamptz not null default now(),
  sent_to_kitchen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  cancelled_at timestamptz,
  cancellation_reason text,
  constraint order_rounds_hotel_order_sequence_unique
    unique (hotel_slug, order_id, sequence_number),
  constraint order_rounds_hotel_order_idempotency_unique
    unique (hotel_slug, order_id, idempotency_key)
);

create index if not exists idx_order_rounds_hotel_order_created
  on public.order_rounds (hotel_slug, order_id, created_at);
create index if not exists idx_order_rounds_hotel_status_created
  on public.order_rounds (hotel_slug, status, created_at);
create index if not exists idx_orders_hotel_active_table_version
  on public.orders (hotel_slug, table_number, status, order_version)
  where parent_order_id is null and order_type = 'dine-in';

alter table public.order_rounds enable row level security;
revoke all on table public.order_rounds from public, anon, authenticated;
grant select, insert, update on table public.order_rounds to service_role;
grant usage, select on sequence public.order_rounds_id_seq to service_role;

create or replace function public.add_staff_items_to_active_order(
  p_hotel_slug text,
  p_order_id text,
  p_table_number text,
  p_expected_version bigint,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_items jsonb,
  p_totals jsonb,
  p_totals_delta jsonb,
  p_note text,
  p_created_by_staff_id bigint,
  p_created_by_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hotel_key text := lower(btrim(coalesce(p_hotel_slug, '')));
  v_table_key text := lower(btrim(coalesce(p_table_number, '')));
  v_order public.orders%rowtype;
  v_existing_round public.order_rounds%rowtype;
  v_round public.order_rounds%rowtype;
  v_sequence integer;
  v_kot_reference text;
  v_round_items jsonb;
begin
  if v_hotel_key = '' or btrim(coalesce(p_order_id, '')) = '' or v_table_key = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CONTEXT', 'message', 'Hotel, order, and table context are required.');
  end if;
  if btrim(coalesce(p_idempotency_key, '')) = '' or length(p_idempotency_key) > 160 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_IDEMPOTENCY_KEY', 'message', 'A valid idempotency key is required.');
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_ITEMS', 'message', 'At least one new item is required.');
  end if;

  select rounds.* into v_existing_round
    from public.order_rounds rounds
   where lower(btrim(rounds.hotel_slug)) = v_hotel_key
     and rounds.order_id = p_order_id
     and rounds.idempotency_key = p_idempotency_key
   limit 1;

  if found then
    if v_existing_round.request_fingerprint is distinct from p_request_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED', 'message', 'This request key was already used for different items.');
    end if;
    select orders.* into v_order
      from public.orders orders
     where orders.id::text = p_order_id
       and lower(btrim(orders.hotel_slug)) = v_hotel_key;
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'order', to_jsonb(v_order),
      'round', to_jsonb(v_existing_round)
    );
  end if;

  select orders.* into v_order
    from public.orders orders
   where orders.id::text = p_order_id
     and lower(btrim(orders.hotel_slug)) = v_hotel_key
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND', 'message', 'Order not found for this hotel.');
  end if;
  if lower(btrim(coalesce(v_order.order_type, ''))) <> 'dine-in' or v_order.parent_order_id is not null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_DINE_IN_ROOT', 'message', 'Only the active root dine-in order can receive more items.');
  end if;
  if lower(btrim(coalesce(v_order.table_number, ''))) <> v_table_key then
    return jsonb_build_object('ok', false, 'code', 'TABLE_CHANGED', 'message', 'This order is no longer assigned to the selected table.');
  end if;
  if lower(btrim(coalesce(v_order.status, 'new'))) not in ('new', 'confirmed', 'preparing') then
    return jsonb_build_object('ok', false, 'code', 'ORDER_CLOSED', 'message', 'This order is no longer open for additional items.');
  end if;
  if lower(btrim(coalesce(v_order.payment_status, 'unpaid'))) not in ('', 'unpaid') then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_LOCKED', 'message', 'Items cannot be added after payment processing has started.');
  end if;
  if lower(btrim(coalesce(v_order.billing_status, 'not_billed'))) not in ('', 'not_billed')
     or coalesce(btrim(v_order.bill_number), '') <> '' then
    return jsonb_build_object('ok', false, 'code', 'BILLING_LOCKED', 'message', 'Items cannot be added after the final bill has been issued.');
  end if;
  if coalesce(v_order.order_version, 1) <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'ORDER_VERSION_CONFLICT',
      'message', 'This order was updated by another staff member.',
      'currentVersion', coalesce(v_order.order_version, 1)
    );
  end if;

  select coalesce(max(rounds.sequence_number), 1) + 1 into v_sequence
    from public.order_rounds rounds
   where lower(btrim(rounds.hotel_slug)) = v_hotel_key
     and rounds.order_id = p_order_id;

  v_kot_reference := 'KOT-' || regexp_replace(p_order_id, '[^A-Za-z0-9_-]+', '', 'g') || '-' || lpad(v_sequence::text, 2, '0');
  select coalesce(jsonb_agg(
    item || jsonb_build_object(
      'orderRoundSequence', v_sequence,
      'kotReference', v_kot_reference,
      'kitchenStatus', 'new',
      'addedAt', now()
    )
  ), '[]'::jsonb)
  into v_round_items
  from jsonb_array_elements(p_items) item;

  insert into public.order_rounds (
    hotel_slug, order_id, sequence_number, kot_reference, source, status,
    items, totals_delta, note, idempotency_key, request_fingerprint,
    created_by_staff_id, created_by_role
  ) values (
    v_order.hotel_slug, p_order_id, v_sequence, v_kot_reference, 'staff', 'new',
    v_round_items, coalesce(p_totals_delta, '{}'::jsonb), nullif(btrim(coalesce(p_note, '')), ''),
    p_idempotency_key, p_request_fingerprint, p_created_by_staff_id,
    nullif(btrim(coalesce(p_created_by_role, '')), '')
  ) returning * into v_round;

  update public.orders
     set items = coalesce(v_order.items, '[]'::jsonb) || v_round_items,
         totals = coalesce(p_totals, '{}'::jsonb),
         order_version = coalesce(v_order.order_version, 1) + 1,
         last_item_added_at = now()
   where id = v_order.id
     and hotel_slug = v_order.hotel_slug
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'order', to_jsonb(v_order),
    'round', to_jsonb(v_round)
  );
exception
  when unique_violation then
    select rounds.* into v_existing_round
      from public.order_rounds rounds
     where lower(btrim(rounds.hotel_slug)) = v_hotel_key
       and rounds.order_id = p_order_id
       and rounds.idempotency_key = p_idempotency_key
     limit 1;
    if found and v_existing_round.request_fingerprint = p_request_fingerprint then
      select orders.* into v_order from public.orders orders
       where orders.id::text = p_order_id and lower(btrim(orders.hotel_slug)) = v_hotel_key;
      return jsonb_build_object('ok', true, 'duplicate', true, 'order', to_jsonb(v_order), 'round', to_jsonb(v_existing_round));
    end if;
    raise;
end;
$$;

revoke all on function public.add_staff_items_to_active_order(
  text, text, text, bigint, text, text, jsonb, jsonb, jsonb, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.add_staff_items_to_active_order(
  text, text, text, bigint, text, text, jsonb, jsonb, jsonb, text, bigint, text
) to service_role;

comment on table public.order_rounds is
  'Immutable item-addition/KOT batches appended to one hotel-scoped active order.';
comment on function public.add_staff_items_to_active_order(
  text, text, text, bigint, text, text, jsonb, jsonb, jsonb, text, bigint, text
) is
  'Atomically validates order locks/version, deduplicates a request, appends trusted item snapshots, updates totals, and creates a new KOT round.';
