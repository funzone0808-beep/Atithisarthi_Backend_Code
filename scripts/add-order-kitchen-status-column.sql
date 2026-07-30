-- Adds optional kitchen workflow state to saved orders.
-- Safe for existing data: the column is nullable and added only if missing.

alter table public.orders
  add column if not exists kitchen_status text;

comment on column public.orders.kitchen_status is
  'Optional kitchen workflow state, for example new, accepted, preparing, ready, served, delayed, or cancelled.';

create index if not exists idx_orders_hotel_slug_kitchen_status
  on public.orders (hotel_slug, kitchen_status)
  where kitchen_status is not null;

create index if not exists idx_orders_hotel_slug_created_at
  on public.orders (hotel_slug, created_at desc);
