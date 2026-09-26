-- Task 3 / TASK3-A read-only verification.
-- Run immediately after task3-tenant-isolation-phase1.sql.
-- Expected: every row reports PASS.

with required_ownership_tables(table_name) as (
  values
    ('contact_submissions'), ('food_order_bill_audit'),
    ('food_order_bill_formats'), ('food_order_bill_snapshots'),
    ('gallery_items'), ('guest_stays'), ('hotel_feature_setting_audit'),
    ('hotel_feature_settings'), ('hotel_floors'), ('hotel_guest_profiles'),
    ('hotel_notification_settings'), ('hotel_ordering_settings'),
    ('hotel_ordering_settings_audit'), ('hotel_payment_route_settings'),
    ('hotel_popup_notifications'), ('hotel_profiles'),
    ('hotel_room_advance_policies'), ('hotel_room_amenities'),
    ('hotel_room_tax_settings'), ('hotel_staff_access'), ('inquiries'),
    ('kds_settings'), ('kds_status_history'), ('kitchen_stations'),
    ('login_page_branding'), ('login_page_branding_audit'),
    ('menu_categories'), ('menu_category_audit'), ('menu_combo_items'),
    ('menu_combo_settings'), ('menu_items'),
    ('notification_card_acknowledgements'), ('notification_events'),
    ('order_rounds'), ('order_support_requests'), ('orders'),
    ('payment_intents'), ('qr_customer_sessions'), ('qr_event_outbox'),
    ('qr_idempotency_records'), ('qr_order_submissions'),
    ('qr_security_events'), ('qr_staff_idempotency_records'),
    ('reservations'), ('restaurant_table_qr_tokens'),
    ('restaurant_tables'), ('room_booking_payments'),
    ('room_booking_refunds'), ('room_bookings'),
    ('room_checkout_bill_audit'), ('room_checkout_bill_formats'),
    ('room_checkout_bill_snapshots'), ('room_checkout_receipts'),
    ('room_housekeeping_tasks'), ('room_images'), ('room_maintenance'),
    ('room_negotiated_rate_approvals'), ('room_operation_audit'),
    ('room_rate_plans'), ('room_shifts'), ('room_stay_rate_adjustments'),
    ('room_tax_rules'), ('room_types'), ('rooms'), ('testimonials'),
    ('payment_attempts'), ('payment_webhook_events'),
    ('payment_webhook_inbox')
),
ownership_columns as (
  select
    r.table_name,
    count(*) filter (where c.column_name = 'tenant_id') as tenant_column_count,
    count(*) filter (where c.column_name = 'property_id') as property_column_count,
    count(*) filter (
      where c.column_name in ('tenant_id', 'property_id')
        and c.is_nullable <> 'YES'
    ) as non_nullable_count,
    count(*) filter (
      where c.column_name in ('tenant_id', 'property_id')
        and c.column_default is not null
    ) as defaulted_count
  from required_ownership_tables r
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = r.table_name
   and c.column_name in ('tenant_id', 'property_id')
  group by r.table_name
),
public_tables as (
  select c.oid, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
checks as (
  select 'tenants_table_present'::text as check_name, 'true'::text as expected,
    (to_regclass('public.tenants') is not null)::text as actual

  union all
  select 'tenants_rls_enabled', 'true', coalesce((
    select c.relrowsecurity::text from pg_class c
    where c.oid = to_regclass('public.tenants')
  ), 'false')

  union all
  select 'all_public_tables_rls_enabled', '0',
    count(*) filter (where not relrowsecurity)::text from public_tables

  union all
  select 'force_rls_not_prematurely_enabled', '0',
    count(*) filter (where relforcerowsecurity)::text from public_tables

  union all
  select 'hotels_tenant_id_nullable', 'true', coalesce((
    select (is_nullable = 'YES' and column_default is null)::text
    from information_schema.columns
    where table_schema = 'public' and table_name = 'hotels'
      and column_name = 'tenant_id'
  ), 'false')

  union all
  select 'required_ownership_table_count', '68', count(*)::text
  from required_ownership_tables

  union all
  select 'missing_tenant_or_property_columns', '0', count(*) filter (
    where tenant_column_count <> 1 or property_column_count <> 1
  )::text from ownership_columns

  union all
  select 'ownership_columns_not_null_too_early', '0',
    coalesce(sum(non_nullable_count), 0)::text from ownership_columns

  union all
  select 'ownership_columns_have_unsafe_defaults', '0',
    coalesce(sum(defaulted_count), 0)::text from ownership_columns

  union all
  select 'tenant_rows_not_auto_created', '0', count(*)::text
  from public.tenants

  union all
  select 'hotels_not_auto_assigned', '0',
    count(*) filter (where tenant_id is not null)::text from public.hotels

  union all
  select 'hotels_tenant_fk_staged_not_valid', 'true', coalesce((
    select (c.contype = 'f' and not c.convalidated)::text
    from pg_constraint c
    where c.conrelid = 'public.hotels'::regclass
      and c.conname = 'hotels_tenant_id_fkey_task3'
  ), 'false')

  union all
  select 'hotels_composite_parent_key_present', 'true', exists (
    select 1 from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.hotels'::regclass
      and idx.relname = 'hotels_tenant_id_id_uidx'
      and i.indisunique and i.indisvalid
  )::text

  union all
  select 'anon_authenticated_tenants_access', '0', count(*)::text
  from (values ('anon'), ('authenticated')) as r(role_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(privilege_name)
  where has_table_privilege(r.role_name, 'public.tenants', p.privilege_name)

  union all
  select 'anon_authenticated_effective_table_privileges', '0', count(*)::text
  from public_tables t
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  cross join (values
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
  ) as p(privilege_name)
  where has_table_privilege(r.role_name, t.oid, p.privilege_name)

  union all
  select 'service_role_tenants_crud_preserved', 'true', (
    has_table_privilege('service_role', 'public.tenants', 'SELECT') and
    has_table_privilege('service_role', 'public.tenants', 'INSERT') and
    has_table_privilege('service_role', 'public.tenants', 'UPDATE') and
    has_table_privilege('service_role', 'public.tenants', 'DELETE')
  )::text

  union all
  select 'rls_policies_not_yet_installed', '0', count(*)::text
  from pg_policies where schemaname in ('public', 'storage')

  union all
  select 'service_role_payment_rpc_preserved', 'true', (
    has_function_privilege(
      'service_role',
      'public.finalize_captured_payment(uuid,text,text,text,text,bigint,text,text,text,text)',
      'EXECUTE'
    ) and
    has_function_privilege(
      'service_role',
      'public.claim_payment_webhook(text,integer,integer)',
      'EXECUTE'
    )
  )::text
)
select check_name, expected, actual,
  case when actual = expected then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
