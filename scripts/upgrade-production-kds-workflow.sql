-- Additive production KDS foundation. Apply after create-active-order-item-rounds.sql.
-- Does not modify billing, payment, stock, order totals, or table-release rules.
alter table public.hotel_staff_access add column if not exists kds_role text not null default 'general';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hotel_staff_access_kds_role_check') then
    alter table public.hotel_staff_access add constraint hotel_staff_access_kds_role_check
      check (kds_role in ('general', 'kitchen', 'expo', 'manager'));
  end if;
end $$;
create table if not exists public.kds_settings (
  hotel_slug text primary key,
  default_view text not null default 'kitchen' check (default_view in ('kitchen', 'expo', 'manager')),
  attention_minutes integer not null default 10 check (attention_minutes between 1 and 120),
  delayed_minutes integer not null default 15 check (delayed_minutes between 2 and 180),
  critical_minutes integer not null default 20 check (critical_minutes between 3 and 240),
  auto_hide_served_seconds integer not null default 30 check (auto_hide_served_seconds between 0 and 3600),
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.kitchen_stations (
  id bigserial primary key, hotel_slug text not null, station_code text not null, station_name text not null,
  display_order integer not null default 0,
  default_preparation_minutes integer not null default 15 check (default_preparation_minutes between 1 and 240),
  is_active boolean not null default true, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (hotel_slug, station_code)
);
create table if not exists public.kds_status_history (
  id bigserial primary key, hotel_slug text not null, order_id text not null,
  round_sequence integer not null default 1, item_reference text, from_status text not null,
  to_status text not null, actor_staff_id text, actor_role text not null,
  client_request_id text, reason text, created_at timestamptz not null default now(),
  unique (hotel_slug, client_request_id)
);
create index if not exists idx_kitchen_stations_hotel_active_order on public.kitchen_stations (hotel_slug, is_active, display_order);
create index if not exists idx_kds_status_history_hotel_order_created on public.kds_status_history (hotel_slug, order_id, created_at desc);
create index if not exists idx_orders_kds_active_hotel_status_created on public.orders (hotel_slug, kitchen_status, created_at)
  where lower(coalesce(kitchen_status, 'new')) not in ('served', 'cancelled');
alter table public.kds_settings enable row level security;
alter table public.kitchen_stations enable row level security;
alter table public.kds_status_history enable row level security;
revoke all on public.kds_settings, public.kitchen_stations, public.kds_status_history from public, anon, authenticated;
grant select, insert, update, delete on public.kds_settings, public.kitchen_stations to service_role;
grant select, insert on public.kds_status_history to service_role;
grant usage, select on sequence public.kitchen_stations_id_seq, public.kds_status_history_id_seq to service_role;
insert into public.kitchen_stations (hotel_slug, station_code, station_name, display_order)
select distinct hotel_slug, 'main', 'Main Kitchen', 0 from public.hotel_staff_access
where hotel_slug is not null and btrim(hotel_slug) <> '' on conflict (hotel_slug, station_code) do nothing;
notify pgrst, 'reload schema';

