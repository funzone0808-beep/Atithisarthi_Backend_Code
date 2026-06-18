-- Adds optional staff attribution to saved orders.
-- Safe for existing data: the column is nullable and added only if missing.
-- Existing order creation continues working even before this migration is applied.

alter table public.orders
  add column if not exists created_by_staff_id bigint;

comment on column public.orders.created_by_staff_id is
  'Optional hotel_staff_access.id for staff-created orders.';

create index if not exists idx_orders_hotel_created_by_staff
  on public.orders (hotel_slug, created_by_staff_id)
  where created_by_staff_id is not null;
