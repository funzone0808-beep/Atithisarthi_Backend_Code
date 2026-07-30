-- Roll back only the additive scalable public Rooms indexes.
drop index if exists public.idx_room_bookings_public_active_overlap;
drop index if exists public.idx_rooms_public_discovery;
