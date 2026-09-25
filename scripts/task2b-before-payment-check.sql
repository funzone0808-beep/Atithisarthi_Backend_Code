-- Task 2B pre-payment baseline for the user-authorized pre-production database.
-- READ ONLY: every statement is SELECT/CTE only.
-- Run this in the Supabase SQL Editor immediately before the first Razorpay TEST payment.
-- Do not modify this file to expose payload, context, digests, idempotency keys, or customer data.

-- 1. Capture the database/time watermark that will separate existing development
-- evidence from the new Task 2B transaction.
select
  now() as task2b_baseline_at,
  current_database() as database_name,
  current_setting('server_version') as postgres_version;

-- 2. Confirm the three Task 2A tables remain present.
select
  to_regclass('public.payment_intents') is not null as payment_intents_present,
  to_regclass('public.payment_attempts') is not null as payment_attempts_present,
  to_regclass('public.payment_webhook_inbox') is not null as payment_webhook_inbox_present;

-- 3. Safe aggregate PaymentIntent baseline.
select
  status,
  count(*) as intent_count,
  count(*) filter (where requires_reconciliation) as reconciliation_count,
  max(created_at) as most_recent_created_at,
  max(updated_at) as most_recent_updated_at
from public.payment_intents
group by status
order by status;

-- 4. Recent intent evidence without request context, digests, idempotency keys,
-- provider identifiers, or customer/order contents.
select
  id as payment_intent_id,
  hotel_slug,
  operation,
  status,
  expected_amount_minor,
  currency,
  provider,
  merchant_ref,
  business_order_id is not null as business_order_linked,
  provider_order_id is not null as provider_order_attached,
  provider_payment_id is not null as provider_payment_attached,
  requires_reconciliation,
  version,
  created_at,
  updated_at,
  paid_at
from public.payment_intents
where created_at >= now() - interval '7 days'
order by created_at desc
limit 25;

-- 5. Safe aggregate payment-attempt baseline.
select
  evidence_source,
  accepted,
  coalesce(rejection_code, '') as rejection_code,
  count(*) as attempt_count,
  max(created_at) as most_recent_created_at
from public.payment_attempts
group by evidence_source, accepted, coalesce(rejection_code, '')
order by evidence_source, accepted desc, rejection_code;

-- 6. Safe webhook-inbox baseline. Payloads, payload digests, provider event IDs,
-- errors, and lease-owner values are deliberately excluded.
select
  status,
  event_type,
  count(*) as event_count,
  max(attempt_count) as maximum_attempt_count,
  max(received_at) as most_recent_received_at,
  max(processed_at) as most_recent_processed_at
from public.payment_webhook_inbox
group by status, event_type
order by status, event_type;

-- 7. Any rows that could already be claimed/reconciled before the TEST payment.
select
  id as payment_intent_id,
  hotel_slug,
  status,
  expected_amount_minor,
  currency,
  business_order_id is not null as business_order_linked,
  provider_order_id is not null as provider_order_attached,
  requires_reconciliation,
  created_at,
  updated_at
from public.payment_intents
where requires_reconciliation
   or status in ('CREATED', 'PENDING', 'AUTHORIZED')
order by updated_at desc
limit 50;

-- 8. Webhook rows eligible for worker claim at baseline. This should normally
-- be empty before the first Task 2B payment.
select
  status,
  event_type,
  attempt_count,
  lease_until,
  received_at
from public.payment_webhook_inbox
where status in ('RECEIVED', 'FAILED')
   or (status = 'PROCESSING' and lease_until < now())
order by received_at
limit 50;
