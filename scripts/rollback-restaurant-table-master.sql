-- Historical orders remain readable through orders.table_number.
drop index if exists public.idx_orders_hotel_restaurant_table;
alter table public.orders drop constraint if exists orders_restaurant_table_id_fkey;
alter table public.orders drop column if exists restaurant_table_id;
alter table public.hotel_ordering_settings drop column if exists enforce_table_master;
drop table if exists public.restaurant_tables;
