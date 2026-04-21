-- Customer order tracking foundation.
-- Run this once in Supabase SQL editor before enabling public tracking links.

alter table public.orders
  add column if not exists tracking_token text;

alter table public.orders
  add column if not exists tracking_token_created_at timestamptz;

create unique index if not exists orders_tracking_token_unique_idx
  on public.orders (tracking_token)
  where tracking_token is not null;

create index if not exists orders_tracking_lookup_idx
  on public.orders (hotel_slug, id, tracking_token)
  where tracking_token is not null;
