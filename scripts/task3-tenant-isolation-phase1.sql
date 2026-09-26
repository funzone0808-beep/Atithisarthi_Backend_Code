-- Task 3 / TASK3-A: additive tenant and property ownership schema.
-- Authorized pre-production database only. Run manually in Supabase SQL Editor.
--
-- This is an EXPAND-ONLY migration:
--   * no application rows are inserted, updated, or deleted;
--   * no existing column is renamed, removed, or made NOT NULL;
--   * no tenant/property value is inferred from hotel_slug;
--   * no final tenant RLS policy or runtime role is installed here;
--   * Task 2 payment evidence is preserved.

begin;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_key text not null,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_tenant_key_not_blank check (length(btrim(tenant_key)) > 0),
  constraint tenants_display_name_not_blank check (length(btrim(display_name)) > 0),
  constraint tenants_status_valid check (status in ('active', 'inactive')),
  constraint tenants_tenant_key_unique unique (tenant_key)
);

comment on table public.tenants is
  'Canonical SaaS tenant. A tenant may own one or more existing hotels/properties.';
comment on column public.tenants.tenant_key is
  'Stable internal human-readable key; never accepted from an untrusted request as authorization.';

alter table public.tenants enable row level security;
revoke all privileges on public.tenants from public, anon, authenticated;
grant select, insert, update, delete on public.tenants to service_role;

-- hotels is the existing canonical property table. Its BIGINT primary key is
-- retained. hotel_slug remains a compatible public routing identifier.
alter table public.hotels add column if not exists tenant_id uuid;

comment on column public.hotels.tenant_id is
  'Canonical tenant owner. Nullable only during Task 3 expand/backfill.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hotels'::regclass
      and conname = 'hotels_tenant_id_fkey_task3'
  ) then
    alter table public.hotels
      add constraint hotels_tenant_id_fkey_task3
      foreign key (tenant_id) references public.tenants(id)
      on update restrict on delete restrict not valid;
  end if;
end;
$$;

create index if not exists hotels_tenant_id_idx on public.hotels (tenant_id);

-- Future parent key for composite (tenant_id, property_id) foreign keys.
-- NULL remains allowed during backfill.
create unique index if not exists hotels_tenant_id_id_uidx
  on public.hotels (tenant_id, id);

-- Deployed property/payment/evidence tables from the authoritative inventory.
-- Nullable columns without defaults leave every legacy row unmapped.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'contact_submissions', 'food_order_bill_audit',
    'food_order_bill_formats', 'food_order_bill_snapshots', 'gallery_items',
    'guest_stays', 'hotel_feature_setting_audit', 'hotel_feature_settings',
    'hotel_floors', 'hotel_guest_profiles', 'hotel_notification_settings',
    'hotel_ordering_settings', 'hotel_ordering_settings_audit',
    'hotel_payment_route_settings', 'hotel_popup_notifications',
    'hotel_profiles', 'hotel_room_advance_policies', 'hotel_room_amenities',
    'hotel_room_tax_settings', 'hotel_staff_access', 'inquiries',
    'kds_settings', 'kds_status_history', 'kitchen_stations',
    'login_page_branding', 'login_page_branding_audit', 'menu_categories',
    'menu_category_audit', 'menu_combo_items', 'menu_combo_settings',
    'menu_items', 'notification_card_acknowledgements', 'notification_events',
    'order_rounds', 'order_support_requests', 'orders', 'payment_intents',
    'qr_customer_sessions', 'qr_event_outbox', 'qr_idempotency_records',
    'qr_order_submissions', 'qr_security_events',
    'qr_staff_idempotency_records', 'reservations',
    'restaurant_table_qr_tokens', 'restaurant_tables',
    'room_booking_payments', 'room_booking_refunds', 'room_bookings',
    'room_checkout_bill_audit', 'room_checkout_bill_formats',
    'room_checkout_bill_snapshots', 'room_checkout_receipts',
    'room_housekeeping_tasks', 'room_images', 'room_maintenance',
    'room_negotiated_rate_approvals', 'room_operation_audit',
    'room_rate_plans', 'room_shifts', 'room_stay_rate_adjustments',
    'room_tax_rules', 'room_types', 'rooms', 'testimonials',
    -- Task 2/legacy evidence inherits ownership from its authoritative intent
    -- when linked. Unlinked signed webhook evidence remains nullable.
    'payment_attempts', 'payment_webhook_events', 'payment_webhook_inbox'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      raise exception 'TASK3-A expected table public.% is missing', target_table;
    end if;

    execute format(
      'alter table public.%I add column if not exists tenant_id uuid, add column if not exists property_id bigint',
      target_table
    );
    execute format(
      'comment on column public.%I.tenant_id is %L', target_table,
      'Canonical tenant owner. Nullable only during Task 3 expand/backfill.'
    );
    execute format(
      'comment on column public.%I.property_id is %L', target_table,
      'Canonical property owner referencing hotels.id after verified Task 3 backfill.'
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
