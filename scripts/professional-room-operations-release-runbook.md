# Professional Room Operations Release Runbook

## Compatibility boundary

This extension keeps the existing Room page, public/admin/staff booking APIs, booking statuses, half-open date overlap rule, GiST exclusion constraint, room-service/KDS linkage, combined checkout feature gate, thermal bills, payments, tenant routing and feature toggles.

The hotel Manager is the existing authenticated `owner` role. Platform Admin remains the separate `admin` token scope and is not granted to a Manager. Normal `staff` can view daily operations, shared availability, create permitted manual bookings and use the existing room-service flow. Configuration, financial room actions, shifts, extensions and Room Reports are protected by `requireStaffManagerAccess`.

## Database rollout

1. Back up the target Supabase database.
2. Apply `create-room-booking-tables.sql` if the foundation is not already present.
3. Apply `upgrade-professional-room-operations.sql` in staging.
4. Reload the PostgREST schema cache.
5. Run `npm run verify:professional-room-operations` and the existing room, checkout, payment, tenant and staff verifiers.
6. Exercise Hotel A and Hotel B with separate Manager and Staff sessions.
7. Apply the upgrade to production during a low-traffic window.

## Required live checks

- Existing online, walk-in, phone, WhatsApp and staff booking payloads still succeed.
- Same-day checkout/check-in succeeds; active overlap returns `ROOM_ALREADY_BOOKED`.
- Scheduled maintenance is removed from public, Platform Admin and Staff availability for the affected dates only.
- Check-in creates one active `guest_stays` row; retry does not duplicate it.
- Checkout creates a dirty housekeeping task and preserves the checkout bill and folio flow.
- Manager shift locks the stay and both rooms, retains history and creates a dirty source-room task.
- Extension rejects a future overlap and preserves the existing paid amount.
- Hotel A identifiers return 404/403 when used by Hotel B.
- Staff receives 403 for every endpoint after the Manager-only boundary.
- Rate plan creation affects only its hotel and future bookings retain `pricing_snapshot`.
- CSV cells beginning with `=`, `+`, `-` or `@` are neutralized.

## Rollback

1. Disable the Room module for the affected hotel only if immediate containment is required.
2. Stop using the new Manager configuration screens.
3. Back up the extension tables if their history must be retained.
4. Apply `rollback-professional-room-operations.sql`.
5. Restart/reload the API schema cache.
6. Run all existing foundation verifiers again.

Rollback deliberately preserves `room_types`, `rooms`, `room_bookings`, `room_booking_payments`, orders, folios, bills and all restaurant data. Columns and tables introduced by the upgrade are removed, so export their history first if required.

## Release truth

Repository verification is not proof that SQL was applied to a client database. Do not use the final production freeze label until migration, authenticated two-hotel isolation, real payment/folio reconciliation, browser QA and staging performance checks pass on the deployment target.
