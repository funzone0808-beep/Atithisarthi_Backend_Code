-- Roll back source-workflow code objects without deleting or rewriting bookings
-- or notification history. Reapply update-notification-events-supported-types.sql
-- afterward if the previous notification constraints are required.

begin;

drop trigger if exists trg_enqueue_website_room_booking_notification on public.room_bookings;
drop function if exists public.enqueue_website_room_booking_notification();
drop trigger if exists trg_room_booking_source_immutable on public.room_bookings;
drop function if exists public.prevent_room_booking_source_change();
drop view if exists public.room_booking_source_migration_audit;
drop function if exists public.get_room_booking_source_summary(text);
drop function if exists public.normalize_room_booking_source_group(text);
drop index if exists public.idx_room_bookings_hotel_source_status_created;
drop index if exists public.idx_room_bookings_hotel_source_created;

commit;
