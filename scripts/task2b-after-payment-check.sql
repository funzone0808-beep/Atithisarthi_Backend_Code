-- Task 2B post-payment verification for the authorized pre-production database.
-- READ ONLY: every statement is SELECT/CTE only.
-- Baseline: 2026-09-24 12:35:06.762417+00
-- Tenant: hotel-sai-raj
-- Payloads, request context, digests, idempotency keys, customer details, and
-- webhook error bodies are deliberately excluded.

-- 1. PaymentIntent created after the clean baseline.
with task2b_intents as (
  select *
  from public.payment_intents
  where hotel_slug = 'hotel-sai-raj'
    and created_at > timestamptz '2026-09-24 12:35:06.762417+00'
)
select
  id as payment_intent_id,
  business_order_id,
  provider,
  merchant_ref,
  expected_amount_minor,
  currency,
  status,
  provider_order_id,
  provider_payment_id,
  provider_status,
  requires_reconciliation,
  version,
  created_at,
  updated_at,
  paid_at
from task2b_intents
order by created_at;

-- 2. Provider evidence attempts for those intents.
with task2b_intents as (
  select id
  from public.payment_intents
  where hotel_slug = 'hotel-sai-raj'
    and created_at > timestamptz '2026-09-24 12:35:06.762417+00'
)
select
  pa.payment_intent_id,
  pa.evidence_source,
  pa.provider,
  pa.merchant_ref,
  pa.provider_order_id,
  pa.provider_payment_id,
  pa.provider_status,
  pa.amount_minor,
  pa.currency,
  pa.accepted,
  pa.rejection_code,
  pa.created_at
from public.payment_attempts pa
join task2b_intents ti on ti.id = pa.payment_intent_id
order by pa.created_at;

-- 3. Webhook delivery and worker completion after the baseline. Raw payload,
-- digest, lease owner, and last_error are not selected.
select
  id as inbox_id,
  provider,
  merchant_ref,
  provider_event_id,
  event_type,
  status,
  attempt_count,
  payment_intent_id,
  received_at,
  processed_at,
  lease_until
from public.payment_webhook_inbox
where provider = 'razorpay'
  and merchant_ref = 'LEGACY_PLATFORM_RAZORPAY'
  and received_at > timestamptz '2026-09-24 12:35:06.762417+00'
order by received_at;

-- 4. Linked business-order financial state. No guest/customer fields are read.
with task2b_intents as (
  select *
  from public.payment_intents
  where hotel_slug = 'hotel-sai-raj'
    and created_at > timestamptz '2026-09-24 12:35:06.762417+00'
)
select
  pi.id as payment_intent_id,
  o.id as business_order_id,
  o.hotel_slug,
  o.status as business_status,
  o.payment_status,
  o.billing_status,
  o.payment_gateway,
  o.gateway_status,
  o.gateway_order_id,
  o.gateway_payment_id,
  o.payment_amount,
  o.payment_currency,
  o.payment_verified_at,
  o.paid_at
from task2b_intents pi
left join public.orders o
  on o.id::text = pi.business_order_id
 and o.hotel_slug = pi.hotel_slug
order by pi.created_at;

-- 5. One-row-per-intent acceptance matrix.
with task2b_intents as (
  select *
  from public.payment_intents
  where hotel_slug = 'hotel-sai-raj'
    and created_at > timestamptz '2026-09-24 12:35:06.762417+00'
), evidence as (
  select
    pa.payment_intent_id,
    count(*) filter (
      where pa.accepted
        and lower(coalesce(pa.provider_status, '')) = 'captured'
        and pa.amount_minor = pi.expected_amount_minor
        and upper(pa.currency) = pi.currency
        and pa.provider_order_id = pi.provider_order_id
        and pa.provider_payment_id = pi.provider_payment_id
        and pa.merchant_ref = pi.merchant_ref
        and pa.provider = pi.provider
    ) as correctly_bound_captured_attempts
  from public.payment_attempts pa
  join task2b_intents pi on pi.id = pa.payment_intent_id
  group by pa.payment_intent_id
), webhook as (
  select
    payment_intent_id,
    count(*) as linked_webhook_events,
    count(*) filter (where status = 'PROCESSED') as processed_webhook_events,
    count(*) filter (where status in ('RECEIVED', 'PROCESSING', 'FAILED')) as incomplete_webhook_events
  from public.payment_webhook_inbox
  where received_at > timestamptz '2026-09-24 12:35:06.762417+00'
  group by payment_intent_id
)
select
  pi.id as payment_intent_id,
  pi.status = 'PAID' as intent_paid,
  pi.provider = 'razorpay' as provider_bound,
  pi.merchant_ref = 'LEGACY_PLATFORM_RAZORPAY' as merchant_bound,
  pi.expected_amount_minor > 0 as amount_valid,
  pi.currency = 'INR' as currency_bound,
  pi.provider_order_id is not null as provider_order_bound,
  pi.provider_payment_id is not null as provider_payment_bound,
  pi.paid_at is not null as paid_timestamp_present,
  not pi.requires_reconciliation as reconciliation_clear,
  coalesce(e.correctly_bound_captured_attempts, 0) as correctly_bound_captured_attempts,
  coalesce(w.linked_webhook_events, 0) as linked_webhook_events,
  coalesce(w.processed_webhook_events, 0) as processed_webhook_events,
  coalesce(w.incomplete_webhook_events, 0) as incomplete_webhook_events,
  o.id is not null as business_order_linked,
  o.payment_status = 'paid' as business_order_paid,
  o.gateway_order_id = pi.provider_order_id as business_provider_order_matches,
  o.gateway_payment_id = pi.provider_payment_id as business_provider_payment_matches,
  o.paid_at is not null as business_paid_timestamp_present
from task2b_intents pi
left join evidence e on e.payment_intent_id = pi.id
left join webhook w on w.payment_intent_id = pi.id
left join public.orders o
  on o.id::text = pi.business_order_id
 and o.hotel_slug = pi.hotel_slug
order by pi.created_at;

-- 6. Exception-only view. PASS requires no rows here for the successful TEST
-- payment. Webhook absence is assessed separately because callback finalization
-- can legitimately occur before asynchronous delivery.
with task2b_intents as (
  select *
  from public.payment_intents
  where hotel_slug = 'hotel-sai-raj'
    and created_at > timestamptz '2026-09-24 12:35:06.762417+00'
)
select
  pi.id as payment_intent_id,
  pi.status as intent_status,
  pi.requires_reconciliation,
  pi.currency,
  pi.provider,
  pi.merchant_ref,
  o.id as business_order_id,
  o.payment_status,
  o.gateway_status
from task2b_intents pi
left join public.orders o
  on o.id::text = pi.business_order_id
 and o.hotel_slug = pi.hotel_slug
where pi.status <> 'PAID'
   or pi.expected_amount_minor <= 0
   or pi.currency <> 'INR'
   or pi.provider <> 'razorpay'
   or pi.merchant_ref <> 'LEGACY_PLATFORM_RAZORPAY'
   or pi.provider_order_id is null
   or pi.provider_payment_id is null
   or pi.paid_at is null
   or pi.requires_reconciliation
   or o.id is null
   or o.payment_status <> 'paid'
   or o.gateway_order_id is distinct from pi.provider_order_id
   or o.gateway_payment_id is distinct from pi.provider_payment_id
   or o.paid_at is null
order by pi.created_at;
