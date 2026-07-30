# Hotel Modules and Reporting Release Runbook

Use this runbook in an approved local, staging, or production deployment. Do not use real guest data in screenshots, and do not share staff PINs, access tokens, payment credentials, or unmasked exports.

## 1. Pre-deployment

1. Back up `public.hotel_feature_settings` and record the current application release identifier.
2. Confirm `create-room-booking-tables.sql` has already been applied and `public.hotel_feature_settings` exists.
3. Run from `backend`:

   ```powershell
   npm.cmd run verify:hotel-modules
   npm.cmd run verify:staff-orders-release
   npm.cmd run verify:room-operations
   npm.cmd run verify:room-double-booking-safety
   npm.cmd run verify:room-checkout-preflight
   npm.cmd run verify:menu-combos
   npm.cmd run verify:dine-in-billing
   npm.cmd run verify:tenant-domain-trust
   ```

4. Treat any failure as a release blocker. The release preflight is offline coverage; it does not replace authenticated browser testing.

## 2. Apply the database upgrade

Run `backend/scripts/upgrade-hotel-module-features.sql` through the approved Supabase/PostgreSQL migration path. The migration is transactional and additive. It:

- preserves all orders, bookings, payments, invoices, rooms, menus, profiles, and staff access records;
- defaults existing tenants to Food enabled;
- derives Rooms from the existing `enable_room_booking` flag;
- normalizes Room Service, reports, and combined features to valid dependencies;
- enforces at least one core module per hotel;
- creates an append-only feature-setting audit table.

After migration, review every row:

```sql
select
  hotel_slug,
  enable_food_module,
  enable_room_module,
  enable_room_service,
  enable_food_reports,
  enable_room_reports,
  enable_combined_reports,
  enable_combined_billing,
  version
from public.hotel_feature_settings
order by hotel_slug;
```

Do not enable combined billing solely because both modules exist. It also requires Room Service and the existing runtime combined-checkout kill switch.

## 3. Tenant test matrix

Use three disposable hotels with distinct domains/slugs and non-production staff credentials.

### Restaurant-only

- Food module and Food Reports on; Rooms off.
- Food navigation, dashboard widgets, ordering, KDS, tables, billing, and Food Reports are visible.
- Room navigation, room metrics, Room Reports, Room Service, combined reports, and combined billing are absent.
- Direct Room API calls return `403 FEATURE_DISABLED`.
- Existing Food order, payment, bill, KDS, and Take Order flows still work.

### Hotel-only

- Rooms and Room Reports on; Food off.
- Room navigation, dashboard metrics, inventory, availability, booking, check-in/out, payments, and Room Reports are visible.
- Take Order, Orders, KDS, Menu, Tables, Food Reports, Room Service, and combined reporting are absent.
- Direct Food API calls return `403 FEATURE_DISABLED`.
- Existing online/manual booking and overlap protection still work.

### Combined hotel

- Food, Rooms, their reports, Room Service, Combined Reports, and optionally Combined Billing on.
- Food and Room operational sections remain visually separate.
- Room Service orders appear in Food Revenue only.
- Combined Revenue equals Net Food Revenue plus Net Room Revenue.
- Combined billing remains disabled until both the tenant feature and runtime kill switch are enabled.

For every tenant type, attempt a request using another hotel's record ID. Expect a safe denial or no matching record; never accept cross-hotel data.

## 4. Permission checks

- Platform Admin can read/change module settings and receives a new audit entry after every save.
- Owner credentials can access financial reports and exports for their own hotel only.
- Normal staff cannot open the owner business-report endpoint or financial exports.
- This codebase currently has `owner` and `staff` roles only. Do not claim a separate Manager permission tier until the staff schema and permission model add one explicitly.

## 5. Reporting accuracy checks

Use a small reconciled fixture set for the selected date range.

- Food recognized revenue excludes cancelled and refunded orders.
- Food `netRevenue = grossRevenue - refunds` under the stored order-total contract.
- Room revenue is prorated by stay nights overlapping `[from, to)`.
- Occupancy `= occupied room nights / available room nights * 100`.
- ADR `= net room revenue / occupied room nights`.
- Combined Revenue `= Food net revenue (including Room Service once) + Room net revenue`.
- Combined checkout allocations are settlement evidence and are not added as revenue.
- Guest phone numbers remain masked in report responses and exports.
- CSV and Excel-compatible values beginning with formula triggers, including whitespace-prefixed triggers, are apostrophe-neutralized.

The report API caps Food orders and Room bookings at 5,000 and marks truncated results. Historical maintenance occupancy uses current room status because the current schema has no maintenance-period history.

## 6. Responsive and screenshot sign-off

Test authenticated pages at 320, 360, 375, 390, 414, 768, 1024, 1280, 1366, 1440, and 1920 px. Confirm no protected module flashes before feature configuration loads, no horizontal page overflow, keyboard-visible focus, labelled controls, usable export actions, and stable mobile navigation.

Capture sanitized screenshots of:

1. Restaurant-only Dashboard
2. Hotel-only Dashboard
3. Combined Dashboard
4. Reports Center
5. Food Reports
6. Room Reports
7. Combined Reports
8. Mobile Reports at 390 px
9. Platform Admin Modules and Features

Review the browser console and network panel for every screenshot state. Redact hotel identifiers, guest information, financial account identifiers, and tokens before sharing.

## 7. Rollback

1. Disable new tenant controls in the deployment and stop feature-setting changes.
2. Restore the previous application release.
3. Run `backend/scripts/rollback-hotel-module-features.sql` through the approved migration path.
4. Verify the original `enable_food_ordering`, `enable_room_booking`, and `enable_room_service` columns and all historical business tables remain present.
5. Rerun the original Food, Staff Orders, Room Operations, payment, and tenant smoke tests.

The rollback removes only the additive module/reporting columns, dependency constraints, version metadata, and audit table. It does not delete operational data.
