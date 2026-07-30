-- Destructive rollback. Back up new KDS tables before running.
drop index if exists public.idx_orders_kds_active_hotel_status_created;
drop table if exists public.kds_status_history;
drop table if exists public.kitchen_stations;
drop table if exists public.kds_settings;
alter table public.hotel_staff_access drop constraint if exists hotel_staff_access_kds_role_check;
alter table public.hotel_staff_access drop column if exists kds_role;
notify pgrst, 'reload schema';

