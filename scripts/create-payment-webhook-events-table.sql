-- Stores payment gateway webhook processing attempts for idempotency.
-- Safe for existing data: creates a separate additive table only if missing.

create table if not exists public.payment_webhook_events (
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  event_type text,
  gateway_order_id text,
  gateway_payment_id text,
  local_order_id text,
  processing_status text not null default 'received',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_payment_webhook_events_provider_event_id
  on public.payment_webhook_events (provider, event_id);

create index if not exists idx_payment_webhook_events_gateway_order
  on public.payment_webhook_events (gateway_order_id)
  where gateway_order_id is not null;

create index if not exists idx_payment_webhook_events_status
  on public.payment_webhook_events (processing_status);

comment on table public.payment_webhook_events is
  'Idempotency and audit log for payment gateway webhook events.';

comment on column public.payment_webhook_events.event_id is
  'Provider webhook event id. Unique per provider to avoid duplicate processing.';
