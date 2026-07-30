-- Roll back only the professional Room Operations extension.
-- Existing room_types, rooms, room_bookings, room_booking_payments and restaurant data are preserved.

drop function if exists public.shift_room_booking(text,bigint,bigint,text,text,text,timestamptz);
drop function if exists public.extend_room_booking(text,bigint,date,text,text,text);
drop trigger if exists trg_sync_guest_stay_from_booking_status on public.room_bookings;
drop function if exists public.sync_guest_stay_from_booking_status();
drop trigger if exists trg_room_booking_pricing_snapshot on public.room_bookings;
drop function if exists public.snapshot_room_booking_pricing();
drop table if exists public.room_operation_audit;
drop table if exists public.room_shifts;
drop table if exists public.guest_stays;
drop table if exists public.hotel_guest_profiles;
drop table if exists public.room_housekeeping_tasks;
drop table if exists public.room_maintenance;
drop table if exists public.hotel_room_amenities;
alter table public.room_bookings drop column if exists previous_room_id;
alter table public.room_bookings drop column if exists idempotency_key;
alter table public.room_bookings drop column if exists pricing_snapshot;
alter table public.room_bookings drop column if exists rate_plan_id;
drop table if exists public.room_rate_plans;
drop index if exists public.room_types_hotel_short_code_unique;
alter table public.room_types drop column if exists check_out_time;
alter table public.room_types drop column if exists check_in_time;
alter table public.room_types drop column if exists extra_child_rate;
alter table public.room_types drop column if exists extra_adult_rate;
alter table public.room_types drop column if exists base_capacity;
alter table public.room_types drop column if exists short_code;
drop index if exists public.idx_rooms_scope_floor_type_status;
alter table public.rooms drop column if exists notes;
alter table public.rooms drop column if exists display_order;
alter table public.rooms drop column if exists smoking_policy;
alter table public.rooms drop column if exists extra_bed_limit;
alter table public.rooms drop column if exists base_occupancy;
alter table public.rooms drop column if exists floor_id;
drop table if exists public.hotel_floors;
