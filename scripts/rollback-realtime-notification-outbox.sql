-- Rollback only the transaction-trigger portion of the real-time notification release.
-- Existing notification events and acknowledgement state are intentionally retained.

drop trigger if exists trg_orders_notification_event on public.orders;
drop trigger if exists trg_room_bookings_notification_event on public.room_bookings;
drop trigger if exists trg_testimonials_notification_event on public.testimonials;
drop function if exists public.record_operational_notification_event();
drop index if exists public.idx_notification_events_hotel_id_desc;