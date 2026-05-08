-- Hardens payment reconciliation by making gateway ids unique when present.
-- Run scripts/verify-payment-gateway-id-uniqueness.js first and only apply this
-- after it reports no duplicates in existing data.
--
-- These indexes are intentionally global across hotels because the current
-- payment provider gateway ids are expected to be unique for the whole platform,
-- and webhook/order-link code resolves them that way today.

create unique index if not exists idx_orders_gateway_order_id_unique
  on public.orders (gateway_order_id)
  where gateway_order_id is not null;

create unique index if not exists idx_orders_gateway_payment_id_unique
  on public.orders (gateway_payment_id)
  where gateway_payment_id is not null;
