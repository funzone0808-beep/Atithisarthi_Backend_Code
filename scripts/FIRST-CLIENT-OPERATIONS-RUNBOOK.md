# First-Client Operations Runbook

Status: release gate — completion evidence required

## 1. Gate record

Record for every item: owner, environment, timestamp, evidence link, result, exception approver, and rollback decision.

| Gate | Required result |
|---|---|
| Production configuration | All production/first-client verifiers pass |
| Database migration | Applied on staging clone, checksum/order recorded, rollback rehearsed |
| Backup and restore | Successful isolated restore within approved RTO and RPO |
| Core E2E | Booking, check-in, POS, KDS, billing, payment, refund, checkout, reports pass |
| Tenant isolation | Authenticated cross-tenant negative suite passes |
| Finance | GST, settlement, refund, cash EOD, and bill reconciliation signed off |
| Performance | Representative workload passes at expected peak plus safety margin |
| Monitoring | Alerts delivered to named on-call responder |
| Training | Manager/front desk/restaurant/kitchen acceptance recorded |
| Rollback | Last known-good build and decision authority verified |

## 2. Environment preparation

1. Provision staging and production separately.
2. Configure HTTPS domains, API/public/admin URLs, CORS, timezone, database, storage, mail, JWT, Razorpay, and launch flags in a managed secret store.
3. Confirm no test keys or localhost URLs remain in production.
4. Create least-privilege staff accounts; do not share credentials.
5. Apply SQL in the rehearsed order and refresh the API schema cache.
6. Save the deployed application version and migration ledger.

## 3. Hotel setup

1. Create the active hotel tenant and verify domain/slug routing.
2. Configure branding and public contact details.
3. Enter floors, room types, rooms, occupancy, amenities, and managed images.
4. Enter date-effective room rates/rate plans.
5. Have the manager/accountant verify and save GST rules covering every sellable date/value range.
6. Configure advance-payment/refund policies.
7. Configure restaurant tables, secure QR sessions, menu, KDS roles, and printers.
8. Add staff and verify each person sees only intended tenant/actions.

## 4. Backup and restore drill

1. Confirm automatic encrypted backups and retention.
2. Capture backup start/end time and recovery point.
3. Restore to a new isolated project/database.
4. Validate schema version and row counts.
5. Sample at least two tenants and verify no cross-tenant joins.
6. Reconcile bookings, orders, bills, payments, refunds, GST snapshots, room images, and audit records.
7. Start an isolated API against the restore and run read-only smoke tests.
8. Record actual RPO/RTO and obtain sign-off.
9. Delete the isolated restore under the approved data-handling policy.

## 5. Core release smoke

Use synthetic guests and clearly marked test transactions:

1. Public room search and availability.
2. Room gallery navigation/close and Book this room handoff.
3. Booking with valid GST/rate and permitted advance.
4. Duplicate/overlap booking rejection.
5. Manual booking, payment, refund, check-in, stay extension, housekeeping, maintenance, and checkout.
6. Table QR order, staff order, Add More Items, KDS preparation, served state, bill, payment, and tracking.
7. Room-service order and combined checkout according to the release flag.
8. Thermal bills and report totals.
9. Webhook retry/idempotency and failed-payment path.
10. Cross-tenant attempts using another tenant’s valid credentials; all must be denied or return no data.

## 6. Finance and end-of-day

1. Reconcile POS bills to payments by method.
2. Reconcile room folios, advances, refunds, and outstanding balances.
3. Reconcile gateway payments/refunds/webhooks to provider settlement reports.
4. Count cash with dual control and record variance.
5. Lock/export the bill register and GST summary.
6. Escalate paid-not-billed, billed-unpaid, missing bill number, duplicate payment, tax mismatch, or unexplained zero-value transactions.
7. Manager signs the EOD report.

## 7. Monitoring and alert drill

Create and test alerts for API health/latency, 5xx/429 spikes, database errors/slow queries, KDS stale orders, QR outbox failures, payment reconciliation, rate/GST rejections, and backup failure.

Trigger one safe synthetic alert and confirm acknowledgement, escalation, status update, recovery, and closure.

## 8. Performance acceptance

Run a representative mixed journey, not only health endpoints. Test 1, 10, 25, 50, 100, and 200 distinct tenants as rollout requires. Capture p50/p95/p99, error/timeout rate, database time, CPU/memory, connections, queue backlog, and correctness.

Set numerical pass thresholds before testing. Connection failures or a non-running API are a failed test, not a benchmark.

## 9. Training and acceptance

- Manager: tax/rates, staff, reports, refunds, EOD, incidents.
- Front desk: booking, payments, check-in, stay operations, checkout.
- Restaurant: tables, orders, rounds, billing, payment, refund policy.
- Kitchen/expo: KDS states, delays, recall/escalation.
- Support/on-call: logs, health, safe feature disablement, rollback, guest communication.

Run role-based scenarios and collect named acceptance.

## 10. Pilot launch

1. Select monitored hours and a limited cohort.
2. Name launch commander, technical owner, hotel manager, finance owner, and rollback authority.
3. Freeze unrelated changes.
4. Confirm dashboards, support channel, backup, last known-good version, and contact tree.
5. Open traffic gradually.
6. Review errors, payments, bookings, KDS age, and support continuously.
7. Hold review at one hour, end of first shift, and end of first day.

## 11. Incident and rollback

- SEV-1: stop or isolate the affected flow, preserve evidence, notify owners, and consider rollback.
- Reconcile in-flight payments and bookings around traffic changes.
- Restore the last known-good version; do not reverse database changes without the rehearsed rollback and a backup.
- Communicate impact/workaround to the client.
- Validate recovery with smoke tests.
- Complete a blameless review with corrective owners and dates.

## 12. Final authorization

Attach the completed gate record to the release. Production authorization requires explicit sign-off from product, hotel operations, finance/tax, security/engineering, and the rollback authority. Product freeze remains a separate user decision.
