-- Adds optional Razorpay Route transfer tracking to saved orders.
-- Safe for existing data: all columns are nullable and added only if missing.

alter table public.orders
  add column if not exists gateway_transfer_id text,
  add column if not exists gateway_transfer_status text,
  add column if not exists gateway_settlement_status text,
  add column if not exists gateway_transfer_error text;

comment on column public.orders.gateway_transfer_id is
  'Optional Razorpay Route transfer id, for example trf_xxxxx.';

comment on column public.orders.gateway_transfer_status is
  'Optional Razorpay Route transfer lifecycle state such as created, pending, processed, failed, reversed, or partially_reversed.';

comment on column public.orders.gateway_settlement_status is
  'Optional Razorpay Route settlement state such as pending, on_hold, or settled.';

comment on column public.orders.gateway_transfer_error is
  'Optional sanitized Razorpay Route transfer error message for operations and support.';

create index if not exists idx_orders_gateway_transfer_id
  on public.orders (gateway_transfer_id)
  where gateway_transfer_id is not null;

create index if not exists idx_orders_hotel_slug_gateway_transfer_status
  on public.orders (hotel_slug, gateway_transfer_status)
  where gateway_transfer_status is not null;
