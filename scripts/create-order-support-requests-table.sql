-- Hotel-scoped QR/table support requests.
-- Safe bridge version:
-- - public customers can request bill/help only through a valid order tracking token
-- - staff/admin visibility can be added without changing the order save flow
-- - WhatsApp remains the fallback even if this table is not installed yet

create table if not exists public.order_support_requests (
  id bigserial primary key,
  hotel_slug text not null,
  hotel_name text not null default '',
  order_id text not null,
  table_number text not null default '',
  request_type text not null
    check (request_type in ('bill', 'help')),
  status text not null default 'new'
    check (status in ('new', 'acknowledged', 'resolved', 'closed')),
  order_status text not null default '',
  message text not null default '',
  source text not null default 'order_tracking',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_support_requests_hotel_created_idx
  on public.order_support_requests (hotel_slug, created_at desc);

create index if not exists order_support_requests_hotel_status_idx
  on public.order_support_requests (hotel_slug, status, created_at desc);

create index if not exists order_support_requests_order_idx
  on public.order_support_requests (hotel_slug, order_id, created_at desc);
