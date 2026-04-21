-- Adds optional payment gateway metadata to saved orders.
-- Safe for existing data: all columns are nullable and added only if missing.

alter table public.orders
  add column if not exists payment_gateway text,
  add column if not exists gateway_order_id text,
  add column if not exists gateway_payment_id text,
  add column if not exists gateway_signature text,
  add column if not exists gateway_status text,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_amount numeric(12,2),
  add column if not exists payment_currency text,
  add column if not exists payment_error text,
  add column if not exists payment_metadata jsonb;

comment on column public.orders.payment_gateway is
  'Optional payment gateway provider name, for example razorpay, stripe, or cashfree.';

comment on column public.orders.gateway_order_id is
  'Optional gateway-side order/session id created by the backend.';

comment on column public.orders.gateway_payment_id is
  'Optional gateway-side payment id returned after payment attempt.';

comment on column public.orders.gateway_signature is
  'Optional gateway signature or verification token captured for backend verification.';

comment on column public.orders.gateway_status is
  'Optional gateway payment lifecycle state, for example initiated, paid, failed, or refunded.';

comment on column public.orders.payment_verified_at is
  'Optional timestamp when backend gateway verification completed successfully.';

comment on column public.orders.payment_amount is
  'Optional payment amount used for gateway verification in major currency units.';

comment on column public.orders.payment_currency is
  'Optional payment currency code, for example INR.';

comment on column public.orders.payment_error is
  'Optional sanitized payment error message for support/debugging.';

comment on column public.orders.payment_metadata is
  'Optional non-secret payment metadata saved by backend gateway flows.';

create index if not exists idx_orders_hotel_slug_payment_gateway
  on public.orders (hotel_slug, payment_gateway)
  where payment_gateway is not null;

create index if not exists idx_orders_gateway_order_id
  on public.orders (gateway_order_id)
  where gateway_order_id is not null;

create index if not exists idx_orders_gateway_payment_id
  on public.orders (gateway_payment_id)
  where gateway_payment_id is not null;

create index if not exists idx_orders_hotel_slug_gateway_status
  on public.orders (hotel_slug, gateway_status)
  where gateway_status is not null;
