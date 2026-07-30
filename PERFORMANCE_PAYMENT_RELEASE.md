# Performance and Hotel Payment Settings Release Runbook

## Current release gate

Application source verification passes. The live schema gate remains blocked until
`scripts/upgrade-production-performance-payment-settings.sql` is applied. The live
verifier is read-only and currently reports that
`hotel_ordering_settings.secure_online_payment_enabled` does not exist.

Do not announce freeze readiness until the migration, restart, authenticated browser
checks, and live verifier all pass.

## What this release changes

- Staff operational polling is restricted to the active workspace. Orders and KDS
  keep a three-second reconciliation interval without refreshing unrelated Room,
  Support, Reservation, Inquiry, Contact, or Testimonial data.
- stale Orders reads are cancelled with `AbortController`;
- Orders, KDS, and table activity use explicit projections instead of `select *`;
- Mark Bill and Mark Paid keep server authority, show local processing, use
  `order_version` compare-and-increment guards, return idempotent replays, and repaint
  only affected cards/summaries/table state;
- request IDs, total API duration, accumulated database duration, response bytes, and
  `Server-Timing` are available for measured diagnosis;
- platform Admin and signed hotel Manager controls support Secure Online Payment,
  COD / Cash on Delivery, and manual Google Pay / UPI;
- the Manager endpoint derives hotel scope from the signed staff token and accepts no
  browser-supplied hotel slug;
- disabled methods are hidden from new customer checkouts and rejected by website,
  secure-QR, and gateway APIs;
- manual UPI also requires that hotel's configured UPI ID; secure online payment still
  requires the existing global Razorpay readiness checks;
- existing orders, payments, invoices, and reports are not rewritten when a method is
  disabled.

## Forward deployment

1. Take the normal Supabase backup/snapshot and record the application version.
2. Run `scripts/upgrade-production-performance-payment-settings.sql` as the database
   owner/service role. Do not wrap the whole file in another transaction because it
   uses `CREATE INDEX CONCURRENTLY`.
3. Confirm every statement completed. If PostgREST reports stale schema metadata,
   reload its schema cache using the platform's normal Supabase procedure.
4. From `backend`, run:

   ```text
   npm run verify:performance-payment-settings-live
   npm run verify:staff-orders-release
   npm run verify:secure-qr
   npm run verify:production-kds
   npm run verify:payment-gateway-readiness
   npm run verify:production-room-pms-live
   npm run verify:room-negotiated-rate-live
   ```

5. Restart the backend so the new route, cache, and observability code is loaded.
6. Use one real Manager session for a test hotel and verify:
   - the Manager payment card appears, while ordinary Staff cannot edit it;
   - saving sends one PATCH and contains no hotel slug;
   - each switch affects only that hotel's new customer checkout;
   - direct API attempts with a disabled method return `PAYMENT_METHOD_DISABLED`;
   - manual UPI is unavailable without a hotel UPI ID;
   - global Razorpay readiness can still block Secure Online Payment;
   - historical orders and bills remain viewable;
   - Mark Bill and Mark Paid show `Updating...`, then repaint the affected card only;
   - a repeated/concurrent action produces one final state and no stale overwrite;
   - View Tables and KDS reconcile within the active-view polling target.
7. Capture the browser Network panel, Console, mobile/tablet layouts, and screenshots
   required by the release record.

## Read-only load evidence

The bundled command is:

```text
npm run load:performance-readonly
```

Default mode tests only health/readiness. A short local 10/25-client smoke run verified
the harness but hit the existing global public limiter:

| Clients | Requests | p50 | p95 | p99 | HTTP 429 rate |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 1,577 | 6.85 ms | 16.67 ms | 46.08 ms | 81.1% |
| 25 | 2,369 | 13.99 ms | 23.66 ms | 55.88 ms | 100% |

These are limiter/harness observations, not Staff Orders performance results and not
proof of 200-hotel capacity. Do not use them as a production capacity claim.

For authenticated read testing, set `PERF_PROFILE=staff-read` and provide either one
`PERF_STAFF_TOKEN` or a `PERF_TENANTS_JSON` array of separately scoped test-hotel
credentials. Set `PERF_REQUIRE_DISTINCT_TENANTS=true` when the result must represent
the number of distinct hotels. Keep production mutation endpoints out of load tests;
use a staging clone for Mark Bill, Mark Paid, booking, and payment concurrency tests.

## Safe rollback

1. Disable the release in the deployment process and restore the previous application
   version.
2. Run `scripts/rollback-production-performance-payment-settings.sql` as the database
   owner. It restores all three methods to enabled, removes the new constraint/trigger,
   and drops only the added indexes concurrently.
3. Restart the previous backend and run its normal release preflight.
4. Preserve the three additive columns and the audit table. They are harmless to old
   code and retain hotel choices/evidence. The optional destructive cleanup block in
   the rollback file must be used only after an explicit retention review.

The rollback never changes existing orders, payment records, invoices, bills, Room
folios, refunds, or reports.
