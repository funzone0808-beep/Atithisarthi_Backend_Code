-- Adds optional metadata for QR/table add-on orders.
-- Safe for existing data: all columns are nullable and added only if missing.
-- This does not change current order creation, billing, payment, or tracking behavior.

alter table public.orders
  add column if not exists parent_order_id text,
  add column if not exists order_group_id text,
  add column if not exists order_entry_type text,
  add column if not exists order_sequence_label text,
  add column if not exists addon_sequence integer;

comment on column public.orders.parent_order_id is
  'Optional original order id when this row is an add-on/sub-order.';

comment on column public.orders.order_group_id is
  'Optional stable grouping key for a base order and its add-on orders.';

comment on column public.orders.order_entry_type is
  'Optional entry type, for example base or add_on.';

comment on column public.orders.order_sequence_label is
  'Optional staff-facing label for add-on orders, for example #2041-A.';

comment on column public.orders.addon_sequence is
  'Optional numeric sequence for add-ons under the same parent order.';

create index if not exists idx_orders_hotel_parent_order
  on public.orders (hotel_slug, parent_order_id)
  where parent_order_id is not null;

create index if not exists idx_orders_hotel_order_group
  on public.orders (hotel_slug, order_group_id)
  where order_group_id is not null;
