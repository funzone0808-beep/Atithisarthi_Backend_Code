-- Production performance indexes and hotel-scoped customer payment controls.
-- Defaults preserve the current checkout behavior for every existing hotel.
-- Run as a database owner/service-role migration. CREATE INDEX CONCURRENTLY
-- statements must not be wrapped in an outer transaction.

begin;

alter table public.hotel_ordering_settings
  add column if not exists secure_online_payment_enabled boolean not null default true,
  add column if not exists cash_on_delivery_enabled boolean not null default true,
  add column if not exists manual_upi_payment_enabled boolean not null default true;

comment on column public.hotel_ordering_settings.secure_online_payment_enabled is
  'Hotel-scoped owner switch for verified online gateway checkout. Global gateway readiness is still required.';
comment on column public.hotel_ordering_settings.cash_on_delivery_enabled is
  'Hotel-scoped owner switch for COD / Cash on Delivery in customer checkout.';
comment on column public.hotel_ordering_settings.manual_upi_payment_enabled is
  'Hotel-scoped owner switch for manual Google Pay / UPI confirmation in customer checkout.';

alter table public.hotel_ordering_settings
  drop constraint if exists hotel_ordering_settings_customer_payment_method_check;
alter table public.hotel_ordering_settings
  add constraint hotel_ordering_settings_customer_payment_method_check
  check (
    customer_ordering_enabled = false
    or secure_online_payment_enabled
    or cash_on_delivery_enabled
    or manual_upi_payment_enabled
  ) not valid;
alter table public.hotel_ordering_settings
  validate constraint hotel_ordering_settings_customer_payment_method_check;

create table if not exists public.hotel_ordering_settings_audit (
  id bigint generated always as identity primary key,
  hotel_slug text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  changed_at timestamptz not null default now(),
  changed_by text not null default current_user
);

comment on table public.hotel_ordering_settings_audit is
  'Append-only audit history for hotel ordering and customer payment-method configuration.';

create or replace function public.audit_hotel_ordering_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.hotel_ordering_settings_audit (
    hotel_slug,
    action,
    old_values,
    new_values,
    changed_by
  ) values (
    coalesce(new.hotel_slug, old.hotel_slug),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    current_user
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_hotel_ordering_settings on public.hotel_ordering_settings;
create trigger trg_audit_hotel_ordering_settings
after insert or update or delete on public.hotel_ordering_settings
for each row execute function public.audit_hotel_ordering_settings_change();

alter table public.hotel_ordering_settings enable row level security;
alter table public.hotel_ordering_settings_audit enable row level security;
revoke all on table public.hotel_ordering_settings from anon, authenticated;
revoke all on table public.hotel_ordering_settings_audit from anon, authenticated;

commit;

-- Tenant-first indexes for the actual high-frequency staff/public query shapes.
create index concurrently if not exists idx_orders_hotel_created_desc
  on public.orders (hotel_slug, created_at desc, id desc);

create index concurrently if not exists idx_orders_hotel_source_created_desc
  on public.orders (hotel_slug, order_source, created_at desc, id desc);

create index concurrently if not exists idx_orders_hotel_billing_payment_created
  on public.orders (hotel_slug, billing_status, payment_status, created_at desc);

create index concurrently if not exists idx_orders_hotel_active_table
  on public.orders (hotel_slug, table_number, created_at desc, id desc)
  where order_type = 'dine-in'
    and parent_order_id is null
    and status in ('new', 'confirmed', 'preparing');

create index concurrently if not exists idx_orders_hotel_kds_open
  on public.orders (hotel_slug, kitchen_status, created_at, id)
  where status not in ('completed', 'cancelled', 'payment_failed');

create index concurrently if not exists idx_order_rounds_hotel_order_sequence
  on public.order_rounds (hotel_slug, order_id, sequence_number);

create index concurrently if not exists idx_menu_items_hotel_live_category_sort
  on public.menu_items (hotel_slug, category, sort_order, item_id)
  where is_available = true and is_archived = false;

create index concurrently if not exists idx_room_bookings_hotel_status_dates
  on public.room_bookings (hotel_slug, booking_status, check_in_date, check_out_date);

create index concurrently if not exists idx_order_support_hotel_status_created
  on public.order_support_requests (hotel_slug, status, created_at desc);

create index concurrently if not exists idx_ordering_settings_audit_hotel_changed
  on public.hotel_ordering_settings_audit (hotel_slug, changed_at desc, id desc);
