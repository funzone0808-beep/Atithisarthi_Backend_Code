-- Safe operational rollback for performance indexes and hotel payment switches.
-- This intentionally preserves configuration columns and audit history so a code
-- rollback cannot erase hotel choices or financial-adjacent evidence.
-- CREATE/DROP INDEX CONCURRENTLY statements must not use an outer transaction.

-- Restore the pre-feature customer experience before deploying older application
-- code. Existing orders and historical payments are not changed.
update public.hotel_ordering_settings
set secure_online_payment_enabled = true,
    cash_on_delivery_enabled = true,
    manual_upi_payment_enabled = true
where secure_online_payment_enabled is distinct from true
   or cash_on_delivery_enabled is distinct from true
   or manual_upi_payment_enabled is distinct from true;

alter table public.hotel_ordering_settings
  drop constraint if exists hotel_ordering_settings_customer_payment_method_check;

-- The trigger is removed during rollback, but the append-only audit rows and
-- columns remain available for investigation and a later forward deployment.
drop trigger if exists trg_audit_hotel_ordering_settings
  on public.hotel_ordering_settings;
drop function if exists public.audit_hotel_ordering_settings_change();

drop index concurrently if exists public.idx_orders_hotel_created_desc;
drop index concurrently if exists public.idx_orders_hotel_source_created_desc;
drop index concurrently if exists public.idx_orders_hotel_billing_payment_created;
drop index concurrently if exists public.idx_orders_hotel_active_table;
drop index concurrently if exists public.idx_orders_hotel_kds_open;
drop index concurrently if exists public.idx_order_rounds_hotel_order_sequence;
drop index concurrently if exists public.idx_menu_items_hotel_live_category_sort;
drop index concurrently if exists public.idx_room_bookings_hotel_status_dates;
drop index concurrently if exists public.idx_order_support_hotel_status_created;
drop index concurrently if exists public.idx_ordering_settings_audit_hotel_changed;

-- Deliberately retained:
--   hotel_ordering_settings.secure_online_payment_enabled
--   hotel_ordering_settings.cash_on_delivery_enabled
--   hotel_ordering_settings.manual_upi_payment_enabled
--   hotel_ordering_settings_audit and all of its rows
--   RLS/revokes on settings and audit tables
--
-- Optional destructive schema cleanup, only after an explicit retention review:
--
-- begin;
-- drop table if exists public.hotel_ordering_settings_audit;
-- alter table public.hotel_ordering_settings
--   drop column if exists secure_online_payment_enabled,
--   drop column if exists cash_on_delivery_enabled,
--   drop column if exists manual_upi_payment_enabled;
-- commit;
--
-- Do not run the optional block during an incident rollback. Keeping additive,
-- unused columns is safer than deleting hotel configuration and audit history.
