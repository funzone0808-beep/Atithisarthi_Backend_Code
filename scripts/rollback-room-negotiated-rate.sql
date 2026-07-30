begin;

-- Disable new negotiated-rate bookings while preserving existing booking
-- snapshots, approval evidence, and Room operation audit history.
drop trigger if exists trg_capture_room_negotiated_rate_approval on public.room_bookings;
drop function if exists public.capture_room_negotiated_rate_approval();
drop function if exists public.room_negotiated_rate_ready();

notify pgrst, 'reload schema';

commit;
