-- Adds optional room-service linkage to saved food orders.
-- Safe for existing data: columns are nullable and added only if missing.
-- This does not change current order creation, KDS, billing, payment, or tracking behavior.

alter table public.orders
  add column if not exists room_id bigint references public.rooms(id) on delete set null,
  add column if not exists room_booking_id bigint references public.room_bookings(id) on delete set null,
  add column if not exists room_number text,
  add column if not exists room_service_guest_name text,
  add column if not exists room_service_charge_to_room boolean default false;

comment on column public.orders.room_id is
  'Optional room linked when a food order is placed as room service.';

comment on column public.orders.room_booking_id is
  'Optional checked-in room booking linked to a room service food order.';

comment on column public.orders.room_number is
  'Optional denormalized room number captured for staff/KDS display.';

comment on column public.orders.room_service_guest_name is
  'Optional guest name captured for room service display and reconciliation.';

comment on column public.orders.room_service_charge_to_room is
  'Whether this room service food order should be added to the room bill at checkout.';

create index if not exists idx_orders_hotel_room_service_booking
  on public.orders (hotel_slug, room_booking_id)
  where room_booking_id is not null;

create index if not exists idx_orders_hotel_room_service_room
  on public.orders (hotel_slug, room_id)
  where room_id is not null;

create index if not exists idx_orders_hotel_room_service_source
  on public.orders (hotel_slug, order_source)
  where order_source = 'room_service';
