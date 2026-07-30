-- Scalable public Rooms discovery indexes.
-- Apply after create-room-booking-tables.sql. These indexes are additive and hotel-scoped.

create index if not exists idx_rooms_public_discovery
  on public.rooms (hotel_slug, is_active, status, room_type_id, room_number);

create index if not exists idx_room_bookings_public_active_overlap
  on public.room_bookings (hotel_slug, room_id, check_in_date, check_out_date)
  where booking_status in ('pending', 'confirmed', 'checked_in');

comment on index public.idx_rooms_public_discovery is
  'Supports hotel-scoped active public room discovery, Room Type drill-down, and stable room-number ordering.';

comment on index public.idx_room_bookings_public_active_overlap is
  'Supports date-overlap availability checks for booking states that block inventory.';
