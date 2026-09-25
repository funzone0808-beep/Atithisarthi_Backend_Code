-- Task 2A: additive payment correctness structures and atomic service-role RPCs.
-- DEVELOPMENT/STAGING ONLY until Task 2B acceptance. Never apply directly to production.
-- TEMPORARY LEGACY OWNERSHIP: hotel_slug remains the owner key until a separately
-- approved tenant architecture migration exists.

create extension if not exists pgcrypto;

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  hotel_slug text not null,
  operation text not null default 'FOOD_ORDER_PAYMENT',
  business_order_id text,
  provider text not null,
  merchant_ref text not null,
  credential_ref text not null,
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  status text not null default 'CREATED' check (
    status in ('CREATED','PENDING','AUTHORIZED','PAID','FAILED','CANCELLED','PARTIALLY_REFUNDED','REFUNDED')
  ),
  idempotency_key text not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  provider_order_id text,
  provider_payment_id text,
  provider_status text,
  requires_reconciliation boolean not null default false,
  provider_creation_started_at timestamptz,
  provider_order_attached_at timestamptz,
  paid_at timestamptz,
  last_error_code text,
  last_error_message text,
  context jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intents_provider_order_unique unique (provider, merchant_ref, provider_order_id),
  constraint payment_intents_provider_payment_unique unique (provider, merchant_ref, provider_payment_id),
  constraint payment_intents_idempotency_unique unique (hotel_slug, operation, idempotency_key)
);

create index if not exists idx_payment_intents_business_order
  on public.payment_intents (hotel_slug, business_order_id)
  where business_order_id is not null;

create index if not exists idx_payment_intents_reconciliation
  on public.payment_intents (updated_at)
  where requires_reconciliation = true or status in ('PENDING','AUTHORIZED');

comment on table public.payment_intents is
  'Task 2A durable online-payment intent. hotel_slug is TEMPORARY LEGACY OWNERSHIP.';
comment on column public.payment_intents.merchant_ref is
  'Non-secret merchant identity, currently LEGACY_PLATFORM_RAZORPAY; never a credential secret.';
comment on column public.payment_intents.credential_ref is
  'Non-secret credential/version label used to bind the expected merchant configuration.';

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id),
  provider text not null,
  merchant_ref text not null,
  provider_order_id text,
  provider_payment_id text,
  provider_status text,
  amount_minor bigint,
  currency text,
  evidence_source text not null,
  evidence_digest text,
  accepted boolean not null default false,
  rejection_code text,
  created_at timestamptz not null default now(),
  constraint payment_attempts_payment_evidence_unique
    unique (payment_intent_id, evidence_source, evidence_digest)
);

create index if not exists idx_payment_attempts_intent_created
  on public.payment_attempts (payment_intent_id, created_at desc);

create table if not exists public.payment_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  merchant_ref text not null,
  provider_event_id text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  event_type text not null,
  payload jsonb not null,
  status text not null default 'RECEIVED' check (
    status in ('RECEIVED','PROCESSING','PROCESSED','FAILED','DEAD_LETTER')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  payment_intent_id uuid references public.payment_intents(id),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_webhook_inbox_event_unique
    unique (provider, merchant_ref, provider_event_id)
);

create index if not exists idx_payment_webhook_inbox_claim
  on public.payment_webhook_inbox (status, lease_until, received_at)
  where status in ('RECEIVED','PROCESSING','FAILED');

create index if not exists idx_payment_webhook_inbox_intent
  on public.payment_webhook_inbox (payment_intent_id)
  where payment_intent_id is not null;

create or replace function public.claim_payment_intent_provider_creation(p_intent_id uuid)
returns public.payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_intent public.payment_intents;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PAYMENT_INTENT_NOT_FOUND'; end if;

  if v_intent.provider_order_id is not null then return v_intent; end if;
  if v_intent.provider_creation_started_at is not null then
    -- An uncertain previous create must be reconciled, never blindly repeated.
    update public.payment_intents set requires_reconciliation = true, updated_at = now(), version = version + 1
      where id = p_intent_id returning * into v_intent;
    return v_intent;
  end if;

  update public.payment_intents
     set status = 'PENDING', provider_creation_started_at = now(), updated_at = now(), version = version + 1
   where id = p_intent_id returning * into v_intent;
  return v_intent;
end;
$$;

create or replace function public.attach_payment_intent_provider_order(
  p_intent_id uuid,
  p_provider_order_id text,
  p_business_order_id text default null
)
returns public.payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_intent public.payment_intents;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PAYMENT_INTENT_NOT_FOUND'; end if;
  if coalesce(btrim(p_provider_order_id), '') = '' then raise exception 'PROVIDER_ORDER_REQUIRED'; end if;
  if v_intent.provider_order_id is not null and v_intent.provider_order_id <> p_provider_order_id then
    raise exception 'PROVIDER_ORDER_CONFLICT';
  end if;
  if v_intent.business_order_id is not null and p_business_order_id is not null
     and v_intent.business_order_id <> p_business_order_id then raise exception 'BUSINESS_ORDER_CONFLICT'; end if;

  update public.payment_intents
     set provider_order_id = p_provider_order_id,
         business_order_id = coalesce(business_order_id, p_business_order_id),
         provider_order_attached_at = coalesce(provider_order_attached_at, now()),
         requires_reconciliation = false,
         updated_at = now(), version = version + 1
   where id = p_intent_id returning * into v_intent;
  return v_intent;
end;
$$;

create or replace function public.finalize_captured_payment(
  p_intent_id uuid,
  p_provider text,
  p_merchant_ref text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_minor bigint,
  p_currency text,
  p_provider_status text,
  p_evidence_source text,
  p_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_intent public.payment_intents; v_order_updated integer := 0;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PAYMENT_INTENT_NOT_FOUND'; end if;

  if v_intent.provider <> p_provider then raise exception 'PROVIDER_MISMATCH'; end if;
  if v_intent.merchant_ref <> p_merchant_ref then raise exception 'MERCHANT_MISMATCH'; end if;
  if v_intent.provider_order_id is null or v_intent.provider_order_id <> p_provider_order_id then raise exception 'PROVIDER_ORDER_MISMATCH'; end if;
  if v_intent.expected_amount_minor <> p_amount_minor then raise exception 'AMOUNT_MISMATCH'; end if;
  if v_intent.currency <> upper(p_currency) then raise exception 'CURRENCY_MISMATCH'; end if;
  if lower(p_provider_status) <> 'captured' then raise exception 'PAYMENT_NOT_CAPTURED'; end if;

  if v_intent.status in ('PAID','PARTIALLY_REFUNDED','REFUNDED') then
    if v_intent.provider_payment_id = p_provider_payment_id then
      return jsonb_build_object('ok', true, 'idempotent', true, 'status', v_intent.status, 'orderUpdated', false);
    end if;
    raise exception 'CONFLICTING_CAPTURED_PAYMENT';
  end if;
  if v_intent.status in ('CANCELLED','REFUNDED') then raise exception 'PAYMENT_STATE_CONFLICT'; end if;

  insert into public.payment_attempts (
    payment_intent_id, provider, merchant_ref, provider_order_id, provider_payment_id,
    provider_status, amount_minor, currency, evidence_source, evidence_digest, accepted
  ) values (
    v_intent.id, p_provider, p_merchant_ref, p_provider_order_id, p_provider_payment_id,
    p_provider_status, p_amount_minor, upper(p_currency), p_evidence_source, p_evidence_digest, true
  ) on conflict (payment_intent_id, evidence_source, evidence_digest) do nothing;

  update public.payment_intents
     set status = 'PAID', provider_payment_id = p_provider_payment_id,
         provider_status = p_provider_status, paid_at = coalesce(paid_at, now()),
         requires_reconciliation = false, last_error_code = null, last_error_message = null,
         updated_at = now(), version = version + 1
   where id = v_intent.id;

  if v_intent.business_order_id is not null then
    update public.orders
       set payment_gateway = p_provider, gateway_order_id = p_provider_order_id,
           gateway_payment_id = p_provider_payment_id, gateway_status = 'paid',
           payment_status = 'paid', payment_verified_at = coalesce(payment_verified_at, now()),
           paid_at = coalesce(paid_at, now()),
           status = case when status in ('payment_pending','payment_failed') then 'new' else status end
     where id::text = v_intent.business_order_id
       and hotel_slug = v_intent.hotel_slug
       and gateway_order_id = p_provider_order_id
       and coalesce(payment_status, '') <> 'paid';
    get diagnostics v_order_updated = row_count;
  end if;

  return jsonb_build_object('ok', true, 'idempotent', false, 'status', 'PAID', 'orderUpdated', v_order_updated = 1);
end;
$$;

create or replace function public.claim_payment_webhook(
  p_lease_owner text,
  p_lease_seconds integer default 60,
  p_max_attempts integer default 12
)
returns setof public.payment_webhook_inbox
language sql
security definer
set search_path = public, pg_temp
as $$
  with candidate as (
    select id from public.payment_webhook_inbox
     where attempt_count < greatest(p_max_attempts, 1)
       and (status in ('RECEIVED','FAILED') or (status = 'PROCESSING' and lease_until < now()))
     order by received_at, id
     for update skip locked limit 1
  )
  update public.payment_webhook_inbox i
     set status = 'PROCESSING', lease_owner = p_lease_owner,
         lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         attempt_count = attempt_count + 1, updated_at = now()
    from candidate c where i.id = c.id returning i.*;
$$;

create or replace function public.complete_payment_webhook(
  p_id uuid,
  p_lease_owner text,
  p_success boolean,
  p_payment_intent_id uuid default null,
  p_last_error text default null,
  p_dead_letter boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  update public.payment_webhook_inbox
     set status = case when p_success then 'PROCESSED' when p_dead_letter then 'DEAD_LETTER' else 'FAILED' end,
         payment_intent_id = coalesce(p_payment_intent_id, payment_intent_id),
         last_error = case when p_success then null else left(coalesce(p_last_error, 'processing failed'), 500) end,
         processed_at = case when p_success then now() else null end,
         lease_owner = null, lease_until = null, updated_at = now()
   where id = p_id and status = 'PROCESSING' and lease_owner = p_lease_owner;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on table public.payment_intents, public.payment_attempts, public.payment_webhook_inbox from public, anon, authenticated;
grant select, insert, update on table public.payment_intents, public.payment_attempts, public.payment_webhook_inbox to service_role;
revoke all on function public.claim_payment_intent_provider_creation(uuid) from public;
revoke all on function public.attach_payment_intent_provider_order(uuid,text,text) from public;
revoke all on function public.finalize_captured_payment(uuid,text,text,text,text,bigint,text,text,text,text) from public;
revoke all on function public.claim_payment_webhook(text,integer,integer) from public;
revoke all on function public.complete_payment_webhook(uuid,text,boolean,uuid,text,boolean) from public;
grant execute on function public.claim_payment_intent_provider_creation(uuid) to service_role;
grant execute on function public.attach_payment_intent_provider_order(uuid,text,text) to service_role;
grant execute on function public.finalize_captured_payment(uuid,text,text,text,text,bigint,text,text,text,text) to service_role;
grant execute on function public.claim_payment_webhook(text,integer,integer) to service_role;
grant execute on function public.complete_payment_webhook(uuid,text,boolean,uuid,text,boolean) to service_role;

notify pgrst, 'reload schema';
