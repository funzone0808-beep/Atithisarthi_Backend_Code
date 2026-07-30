-- Secure, hotel-scoped QR table ordering.
-- Prerequisites: restaurant table master, active-order guard, order tracking,
-- billing metadata, kitchen status, and active order item rounds migrations.

create extension if not exists pgcrypto;

create table if not exists public.restaurant_table_qr_tokens (
  id bigserial primary key,
  hotel_slug text not null,
  restaurant_table_id bigint not null references public.restaurant_tables(id) on delete cascade,
  token_hash text not null,
  token_prefix text not null,
  token_ciphertext text not null,
  token_version bigint not null default 1,
  is_active boolean not null default true,
  created_by_staff_id bigint,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint restaurant_table_qr_tokens_hash_unique unique (token_hash),
  constraint restaurant_table_qr_tokens_hash_format check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint restaurant_table_qr_tokens_prefix_safe check (char_length(token_prefix) between 3 and 20)
);

create unique index if not exists uq_restaurant_table_qr_tokens_active_table
  on public.restaurant_table_qr_tokens (hotel_slug, restaurant_table_id)
  where is_active = true and revoked_at is null;
create index if not exists idx_restaurant_table_qr_tokens_lookup
  on public.restaurant_table_qr_tokens (token_hash, is_active);
create index if not exists idx_restaurant_table_qr_tokens_hotel_table
  on public.restaurant_table_qr_tokens (hotel_slug, restaurant_table_id, is_active);

create table if not exists public.qr_customer_sessions (
  id uuid primary key default gen_random_uuid(),
  public_reference uuid not null default gen_random_uuid() unique,
  hotel_slug text not null,
  restaurant_table_id bigint not null references public.restaurant_tables(id) on delete cascade,
  qr_token_id bigint not null references public.restaurant_table_qr_tokens(id) on delete cascade,
  qr_token_version bigint not null,
  session_token_hash text not null unique,
  csrf_token_hash text not null,
  permission_scope text not null default 'table_order',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint qr_customer_sessions_expiry check (expires_at > created_at),
  constraint qr_customer_sessions_scope check (permission_scope = 'table_order')
);
create index if not exists idx_qr_customer_sessions_hotel_table_expiry
  on public.qr_customer_sessions (hotel_slug, restaurant_table_id, expires_at);
create index if not exists idx_qr_customer_sessions_token_expiry
  on public.qr_customer_sessions (qr_token_id, expires_at);

create table if not exists public.qr_order_submissions (
  id uuid primary key default gen_random_uuid(),
  public_reference uuid not null default gen_random_uuid() unique,
  hotel_slug text not null,
  restaurant_table_id bigint not null references public.restaurant_tables(id) on delete restrict,
  qr_session_id uuid not null references public.qr_customer_sessions(id) on delete restrict,
  order_id text not null,
  round_sequence integer not null check (round_sequence >= 1),
  source text not null default 'qr' check (source = 'qr'),
  status text not null default 'new'
    check (status in ('pending', 'new', 'accepted', 'preparing', 'ready', 'served', 'cancelled', 'rejected')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  totals_delta jsonb not null default '{}'::jsonb check (jsonb_typeof(totals_delta) = 'object'),
  note text,
  row_version bigint not null default 1,
  edit_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  constraint qr_order_submissions_round_unique unique (hotel_slug, order_id, round_sequence)
);
create index if not exists idx_qr_order_submissions_session_created
  on public.qr_order_submissions (qr_session_id, created_at desc);
create index if not exists idx_qr_order_submissions_hotel_order
  on public.qr_order_submissions (hotel_slug, order_id, round_sequence);

create table if not exists public.qr_idempotency_records (
  id bigserial primary key,
  hotel_slug text not null,
  qr_session_id uuid not null references public.qr_customer_sessions(id) on delete cascade,
  action_scope text not null,
  idempotency_key_hash text not null,
  request_fingerprint text not null,
  response_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint qr_idempotency_records_unique unique (qr_session_id, action_scope, idempotency_key_hash)
);
create index if not exists idx_qr_idempotency_records_cleanup
  on public.qr_idempotency_records (expires_at);

create table if not exists public.qr_security_events (
  id bigserial primary key,
  hotel_slug text,
  restaurant_table_id bigint,
  order_id text,
  submission_reference text,
  actor_type text not null default 'qr_customer',
  actor_reference text,
  event_type text not null,
  request_id text,
  safe_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_qr_security_events_hotel_created
  on public.qr_security_events (hotel_slug, created_at desc);

create table if not exists public.qr_event_outbox (
  id bigserial primary key,
  hotel_slug text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  deduplication_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text
);
create index if not exists idx_qr_event_outbox_pending
  on public.qr_event_outbox (next_attempt_at, id) where published_at is null;
create index if not exists idx_qr_event_outbox_hotel_created
  on public.qr_event_outbox (hotel_slug, created_at desc);

alter table public.restaurant_table_qr_tokens enable row level security;
alter table public.qr_customer_sessions enable row level security;
alter table public.qr_order_submissions enable row level security;
alter table public.qr_idempotency_records enable row level security;
alter table public.qr_security_events enable row level security;
alter table public.qr_event_outbox enable row level security;

revoke all on public.restaurant_table_qr_tokens, public.qr_customer_sessions,
  public.qr_order_submissions, public.qr_idempotency_records,
  public.qr_security_events, public.qr_event_outbox from public, anon, authenticated;
grant select, insert, update on public.restaurant_table_qr_tokens, public.qr_customer_sessions,
  public.qr_order_submissions, public.qr_idempotency_records,
  public.qr_security_events, public.qr_event_outbox to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.merge_qr_order_totals(p_existing jsonb, p_delta jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_existing, '{}'::jsonb) || jsonb_build_object(
    'subtotal', coalesce((p_existing->>'subtotal')::numeric, 0) + coalesce((p_delta->>'subtotal')::numeric, 0),
    'gst', coalesce((p_existing->>'gst')::numeric, 0) + coalesce((p_delta->>'gst')::numeric, 0),
    'deliveryCharge', coalesce((p_existing->>'deliveryCharge')::numeric, 0) + coalesce((p_delta->>'deliveryCharge')::numeric, 0),
    'normalTotal', coalesce((p_existing->>'normalTotal')::numeric, coalesce((p_existing->>'total')::numeric, 0)) +
      coalesce((p_delta->>'normalTotal')::numeric, coalesce((p_delta->>'total')::numeric, 0)),
    'total', coalesce((p_existing->>'total')::numeric, 0) + coalesce((p_delta->>'total')::numeric, 0)
  );
$$;

create or replace function public.submit_secure_qr_table_order(
  p_token_hash text,
  p_session_hash text,
  p_idempotency_key_hash text,
  p_request_fingerprint text,
  p_order jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_token public.restaurant_table_qr_tokens%rowtype;
  v_session public.qr_customer_sessions%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_order public.orders%rowtype;
  v_round public.order_rounds%rowtype;
  v_submission public.qr_order_submissions%rowtype;
  v_idempotency public.qr_idempotency_records%rowtype;
  v_sequence integer := 1;
  v_kot_reference text;
  v_items jsonb := coalesce(p_order->'items', '[]'::jsonb);
  v_totals jsonb := coalesce(p_order->'totals', '{}'::jsonb);
  v_response jsonb;
  v_first_order boolean := false;
begin
  if coalesce(p_token_hash, '') = '' or coalesce(p_session_hash, '') = '' or
     coalesce(p_idempotency_key_hash, '') = '' or coalesce(p_request_fingerprint, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SECURE_CONTEXT');
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_ITEMS');
  end if;

  select * into v_token from public.restaurant_table_qr_tokens
   where token_hash = p_token_hash and is_active = true and revoked_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'INVALID_QR_TOKEN'); end if;

  select * into v_table from public.restaurant_tables
   where id = v_token.restaurant_table_id and hotel_slug = v_token.hotel_slug for update;
  if not found or v_table.is_active is not true or v_table.operational_status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'QR_TABLE_INACTIVE');
  end if;

  select * into v_session from public.qr_customer_sessions
   where session_token_hash = p_session_hash for update;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() or
     v_session.hotel_slug <> v_token.hotel_slug or
     v_session.restaurant_table_id <> v_token.restaurant_table_id or
     v_session.qr_token_id <> v_token.id or
     v_session.qr_token_version <> v_token.token_version then
    return jsonb_build_object('ok', false, 'code', 'QR_SESSION_INVALID');
  end if;

  select * into v_idempotency from public.qr_idempotency_records
   where qr_session_id = v_session.id and action_scope = 'submit'
     and idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_idempotency.request_fingerprint <> p_request_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    return v_idempotency.response_json || jsonb_build_object('duplicate', true);
  end if;

  select * into v_order from public.orders
   where hotel_slug = v_token.hotel_slug
     and restaurant_table_id = v_token.restaurant_table_id
     and order_type = 'dine-in' and parent_order_id is null
     and (lower(coalesce(status, '')) in ('new','confirmed','preparing') or
       lower(coalesce(kitchen_status, '')) in ('new','accepted','preparing','ready','delayed'))
     and lower(coalesce(payment_status, 'unpaid')) in ('','unpaid','customer_confirmed')
   order by created_at desc, id desc limit 1 for update;

  if not found then
    v_first_order := true;
    insert into public.orders (
      hotel_name, hotel_slug, customer_name, customer_phone, customer_address,
      payment_method, note, items, totals, whatsapp_message, status,
      kitchen_status, order_type, table_number, order_source,
      restaurant_table_id, payment_status, billing_status,
      tracking_token, tracking_token_created_at, order_version
    ) values (
      p_order->>'hotelName', v_token.hotel_slug, p_order->>'customerName',
      p_order->>'customerPhone', p_order->>'customerAddress',
      coalesce(p_order->>'paymentMethod', 'COD'), p_order->>'note', v_items, v_totals,
      p_order->>'whatsappMessage', 'new', 'new', 'dine-in', v_table.table_code, 'qr',
      v_table.id, coalesce(p_order->>'paymentStatus', 'unpaid'), 'not_billed',
      p_order->>'trackingToken', now(), 1
    ) returning * into v_order;
    v_sequence := 1;
    v_kot_reference := 'KOT-' || regexp_replace(v_order.id::text, '[^A-Za-z0-9_-]+', '', 'g') || '-01';
  else
    select coalesce(max(sequence_number), 1) + 1 into v_sequence
      from public.order_rounds where hotel_slug = v_token.hotel_slug and order_id = v_order.id::text;
    v_kot_reference := 'KOT-' || regexp_replace(v_order.id::text, '[^A-Za-z0-9_-]+', '', 'g') || '-' || lpad(v_sequence::text, 2, '0');
    insert into public.order_rounds (
      hotel_slug, order_id, sequence_number, kot_reference, source, status,
      items, totals_delta, note, idempotency_key, request_fingerprint,
      created_by_staff_id, created_by_role
    ) values (
      v_token.hotel_slug, v_order.id::text, v_sequence, v_kot_reference, 'qr', 'new',
      v_items, v_totals, nullif(p_order->>'note', ''), p_idempotency_key_hash,
      p_request_fingerprint, null, 'qr_customer'
    ) returning * into v_round;
    update public.orders set
      items = coalesce(items, '[]'::jsonb) || v_items,
      totals = public.merge_qr_order_totals(totals, v_totals),
      order_version = coalesce(order_version, 1) + 1,
      last_item_added_at = now()
     where id = v_order.id returning * into v_order;
  end if;

  insert into public.qr_order_submissions (
    public_reference, hotel_slug, restaurant_table_id, qr_session_id, order_id,
    round_sequence, status, items, totals_delta, note, edit_expires_at
  ) values (
    (p_order->>'submissionReference')::uuid, v_token.hotel_slug, v_table.id, v_session.id, v_order.id::text,
    v_sequence, 'new', v_items, v_totals, nullif(p_order->>'note', ''), now() + interval '10 minutes'
  ) returning * into v_submission;

  v_response := jsonb_build_object(
    'ok', true, 'duplicate', false, 'firstOrder', v_first_order,
    'order', to_jsonb(v_order), 'round', case when v_first_order then null else to_jsonb(v_round) end,
    'submission', to_jsonb(v_submission), 'kotReference', v_kot_reference
  );

  insert into public.qr_idempotency_records (
    hotel_slug, qr_session_id, action_scope, idempotency_key_hash,
    request_fingerprint, response_json, expires_at
  ) values (
    v_token.hotel_slug, v_session.id, 'submit', p_idempotency_key_hash,
    p_request_fingerprint, v_response, now() + interval '24 hours'
  );
  insert into public.qr_event_outbox (
    hotel_slug, aggregate_type, aggregate_id, event_type, deduplication_key, payload
  ) values (
    v_token.hotel_slug, 'order', v_order.id::text,
    case when v_first_order then 'QR_ORDER_CREATED' else 'QR_ITEMS_ADDED' end,
    'qr-submit:' || v_session.id::text || ':' || p_idempotency_key_hash,
    jsonb_build_object('orderId', v_order.id, 'tableNumber', v_table.table_code,
      'roundSequence', v_sequence, 'submissionReference', v_submission.public_reference,
      'kotReference', v_kot_reference, 'source', 'qr')
  );
  insert into public.qr_security_events (
    hotel_slug, restaurant_table_id, order_id, submission_reference,
    actor_reference, event_type, request_id, safe_context
  ) values (
    v_token.hotel_slug, v_table.id, v_order.id::text, v_submission.public_reference::text,
    v_session.public_reference::text, case when v_first_order then 'QR_ORDER_CREATED' else 'QR_ITEMS_ADDED' end,
    nullif(p_request_id, ''), jsonb_build_object('roundSequence', v_sequence, 'itemCount', jsonb_array_length(v_items))
  );
  update public.restaurant_table_qr_tokens set last_used_at = now() where id = v_token.id;
  update public.qr_customer_sessions set last_seen_at = now() where id = v_session.id;
  return v_response;
end;
$$;

revoke all on function public.submit_secure_qr_table_order(text,text,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.submit_secure_qr_table_order(text,text,text,text,jsonb,text)
  to service_role;

comment on table public.restaurant_table_qr_tokens is 'Revocable, rotatable opaque QR credentials bound to exactly one hotel table.';
comment on table public.qr_customer_sessions is 'Short-lived public ordering sessions bound to one QR token version and table.';
comment on table public.qr_order_submissions is 'Session-owned QR submissions mapped to root KOT 1 or a later order_rounds KOT batch.';
comment on table public.qr_event_outbox is 'Reliable hotel-scoped QR table, staff notification, and KDS delivery queue.';
