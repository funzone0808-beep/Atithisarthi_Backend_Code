# Secure QR Table Ordering Release Runbook

## Required migration order

Run these files in the Supabase SQL editor for the target project, in order:

1. `create-secure-qr-table-ordering.sql`
2. `upgrade-secure-qr-corrections.sql`
3. `upgrade-secure-qr-staff-corrections.sql`
4. `upgrade-secure-qr-order-lifecycle.sql`

All four migrations are designed to be re-runnable. The third migration creates or replaces the Staff/Manager correction RPC. The fourth synchronizes completed/cancelled kitchen state, releases fully billed-and-paid tables, repairs older settled rows, and reloads the PostgREST schema cache.

## Verification

From the `backend` directory, run:

```powershell
npm run verify:secure-qr
npm run verify:secure-qr-live
npm run verify:staff-orders-release
```

Expected result: all commands pass. The live check must report `INVALID_STAFF_CORRECTION` for its deliberately invalid Staff RPC probe; a missing-function/schema-cache error is a release blocker.

## Controlled acceptance test

Use a non-production table first:

1. Generate a secure QR link from Staff > Table Master.
2. Open the link in a private browser window and submit one low-value test item.
3. Confirm the KDS and Staff Orders screens show it within one refresh cycle (about three seconds) and only one KOT is created.
4. Edit the unaccepted submission as Staff, then approve it.
5. Confirm the customer status page reflects the current kitchen state.
6. Rotate the table QR and confirm the old printed link is rejected.
7. Revoke the new QR and confirm it is also rejected.
8. Check `qr_security_events`, `qr_event_outbox`, and `notification_events` for the matching audit/event trail.

Do not use a real paid order for the acceptance test. Staff edits are locked after kitchen acceptance; only a Manager can perform a reasoned controlled cancellation before Ready/Served, and billed or paid orders remain locked.

## Rollback

If the secure QR feature must be removed, first stop serving secure QR links, then run `rollback-secure-qr-table-ordering.sql`. The rollback removes secure QR functions and tables but preserves existing orders and KOT/round records.

## Freeze conditions

Freeze only when the static, live, and Staff release checks all pass; one complete browser acceptance cycle has passed; deployment host/domain settings are configured; and any exposed service-role credential has been rotated.
