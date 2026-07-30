# Manual Room Booking Advance Payment — Implementation Report

Date: 2026-07-27  
Status: code-complete; deployment verification required before production freeze

## 1. Existing booking-payment architecture

The project is an Express + Supabase/PostgreSQL application with static HTML/JavaScript clients.

- Manual Platform Admin booking: `routes/admin-room-booking.js`
- Hotel Manager/Staff booking: `routes/staff-room-booking.js`
- Trusted price and GST: `utils/room-pricing.js` and `utils/room-tax.js`
- Booking ledger: `room_bookings` and `room_booking_payments`
- Refund ledger: `room_booking_refunds`
- Checkout combination: `utils/room-checkout-summary.js`
- Combined settlement: `utils/room-combined-checkout.js`
- Issued final folio: Room checkout bill snapshot flow

Before this change, Platform Admin booking accepted one `advancePaid` and one method. It inserted the
booking and payment separately, then attempted a compensating booking delete if payment creation
failed. Staff booking creation had no booking-time advance. Additional payments were already
transaction-safe after the production pricing/GST migration, and checkout already used
`balance_amount` plus only unpaid Room Service charges.

## 2. Selected financial architecture

`room_booking_payments` remains the financial payment ledger. No second manual-booking payment
system was created.

- One advance method produces one confirmed payment row.
- Split advance produces multiple method rows sharing `payment_group_id`.
- Every payment line has its own amount, method, receipt reference, receiver, status, and timestamp.
- `room_bookings.advance_paid`, `balance_amount`, and `payment_status` remain compatibility summaries.
- Atomic SQL reconciles the summaries from confirmed payments, net of completed refunds.
- Booking status remains independent of payment status.
- Advances remain linked to the booking through check-in and room shift; they are not recreated.
- Checkout uses the booking balance once. Paid Room Service is excluded from the outstanding
  charge-to-room amount.

## 3. Exact files changed

- `backend/utils/room-advance-payment.js` — policy normalization, safe advance planning, summaries,
  receipt response, masking, and request fingerprints.
- `backend/validators/rooms.js` — compatible optional advance, split-line, and policy schemas.
- `backend/routes/admin-room-booking.js` — atomic advance-bearing booking creation, policy read,
  payment history, receipts, and financial conflict handling.
- `backend/routes/staff-room-booking.js` — Manager/authorized Staff booking advances, Manager policy,
  payment history, receipts, and financial conflict handling.
- `backend/scripts/upgrade-manual-room-booking-advance-payment.sql` — additive schema, constraints,
  indexes, tenant trigger, atomic booking/advance RPC, and hardened additional-payment RPC.
- `backend/scripts/rollback-manual-room-booking-advance-payment.sql` — reversible schema rollback.
- `backend/scripts/verify-manual-room-booking-advance-payment.js` — financial and source-contract tests.
- `frontend/admin.html` — No/Partial/Full/Split advance controls and responsive layout.
- `frontend/js/admin.js` — advance payload, method filtering, loading, and verified summary.
- `frontend/staff-orders.html` — booking advance controls and Manager policy controls.
- `frontend/js/staff-orders.js` — policy load/save, role-aware controls, method filtering, payload,
  loading, and verified summary.

Unrelated Dashboard, Food Operations, Take Order, Orders, KDS, QR, public booking, Room Service,
final bill, and report files were not edited by this implementation.

## 4. Database changes

### `hotel_room_advance_policies`

Hotel-scoped policy with safe existing-hotel defaults:

- mode: optional
- minimum: fixed INR 0
- zero advance: allowed
- multiple payments: allowed
- split payments: allowed
- Staff booking advance: disabled, preserving the old permission behavior
- methods: cash, UPI, card, bank transfer
- automatic cancellation: disabled
- optimistic version: 1

### `room_bookings`

- `request_fingerprint` rejects an idempotency-key replay with changed booking/payment details.

### `room_booking_payments`

- `payment_type`
- `payment_group_id`
- `receipt_reference`
- `currency`
- `received_by`
- `received_role`
- `provider_reference`
- `version`

Indexes cover hotel/booking/status/time reconciliation, payment groups, scoped receipt uniqueness,
scoped provider-reference uniqueness, and booking payment reports. A trigger rejects a payment whose
hotel does not match its booking.

The migration preserves old rows and backfills deterministic references for confirmed legacy
payments. Existing bookings remain optional/zero-advance compatible.

## 5. Create Room Booking flow

- No Advance: follows the prior booking insert and returns unpaid/full balance.
- Partial: server prices first, validates the amount, creates booking and payment atomically, and
  returns partial/balance.
- Full: client does not submit a trusted total; the backend uses the verified booking total.
- Split: two to ten positive method lines must use enabled hotel methods; their sum may not exceed
  the verified total.
- Multiple installments: the existing additional-payment action uses the hardened atomic ledger RPC
  and hotel policy.

The previous request fields remain valid. New fields are optional and additive.

## 6. Advance policy settings

Manager-only mutation:

- Disabled / Optional / Required
- Fixed / Percentage minimum
- Minimum value
- Allow zero
- Allow multiple installments
- Allow split methods
- Allow Staff to record a booking-time advance
- Permitted Room methods

Automatic cancellation is deliberately fixed off. Gateway-backed online Room payment is not exposed
until Room gateway verification/webhook allocation exists.

## 7. Financial calculations

Trusted charge total remains:

`room charge + applicable GST - discount = booking total`

Outstanding remains:

`final eligible charges - confirmed net payments + valid refund effects`

Money values use PostgreSQL `numeric` and two-decimal backend normalization. GST is calculated on
accommodation charges, not on the advance payment. Overpayment is rejected; it is not silently
converted to revenue or guest credit.

## 8. Check-in, folio, room shift, and extension

The existing system keeps payment rows linked to the booking. Check-in does not duplicate or transfer
them. Room shift changes the booking room while preserving booking ID and payment history. Stay
extension recalculates charges and `balance_amount` against the preserved net paid amount.

## 9. Checkout

`buildRoomCheckoutSummary` calculates:

`room booking balance + unpaid charge-to-room Room Service = final payable`

Paid Room Service and separately settled food orders are not counted again. Full advance can return
to partial after an extension or additional eligible charge increases the booking total.

## 10. Cancellation, no-show, refund, and overpayment

- Cancellation/no-show releases availability through the existing status/overlap contract.
- Original payment rows are never deleted by refund.
- Completed refunds reduce the booking net paid amount and increase the balance.
- Refunds remain Manager-only, idempotent, hotel-scoped, reasoned, and credit-note backed.
- The current no-show behavior retains the advance until a Manager records an authorized refund.
- Overpayment is rejected. A separate guest-credit/security-deposit ledger was not invented.

## 11. Payment methods and security

Only methods enabled by the hotel Room advance policy are accepted and displayed. Provider references
are unique per hotel/method when present and masked on receipts. Card secrets, CVV, gateway keys, and
tokens are not accepted or returned.

Hotel identity is always taken from authenticated Admin selection or the signed Staff hotel. Booking,
payment, policy, history, and receipt queries include the hotel scope. The database trigger provides
an additional cross-hotel payment guard.

## 12. Permissions

- Platform Admin retains the existing admin booking capability without becoming a hotel Manager.
- Hotel Manager can configure policy, record installments, view history/receipts, checkout, and refund.
- Staff can keep creating zero-advance bookings.
- Staff can record a booking-time advance only when the hotel's Manager enables it.
- Refund, additional payment, status transition, and combined checkout remain Manager-only under the
  current binary role architecture.

## 13. Reports and reconciliation

Existing Room reports already load `room_booking_payments`, group payments by booking/method, report
advances and outstanding balances, and exclude cancelled/no-show revenue under the existing accounting
contract. The new rows use that same table and therefore enter the existing reports without a second
reporting path.

## 14. Performance

Local financial-plan validation: 5,000 executions in 12.71 ms on the development machine. This is a
logic micro-benchmark, not an endpoint SLA.

Query improvements:

- scoped booking/status/time payment index
- scoped payment-group index
- scoped receipt uniqueness
- scoped provider reference uniqueness
- scoped booking payment-report index

Production p95 price, booking, payment, receipt, checkout, request-count, and query-plan measurements
remain deployment gates.

## 15. Tests

Passed:

- dedicated advance financial/security/responsive verifier
- Room Operations module
- Professional Room Operations
- Production Room PMS/GST: 15/15
- double-booking safety
- booking action permissions
- booking production-gap audit
- checkout summary
- checkout data readiness
- combined checkout preflight
- checkout thermal bill
- negotiated rate: 7/7
- Staff access schema
- Staff Orders UI
- Staff Orders release preflight
- Staff reports
- hotel modules/reporting
- tenant/domain trust
- performance/payment source verification
- syntax checks for all changed JavaScript

The checkout-readiness check queried the configured development database read-only and reported one
sample booking/payment/order with no writes.

## 16. Known limitations and mandatory deployment gates

- The migration has not been applied by this task.
- No authenticated two-hotel write/isolation test was run against a migrated staging database.
- No real cash/UPI/card receipt printer test was run.
- Room gateway payment verification and webhooks are not integrated; online is intentionally absent
  from the default Room methods.
- No configurable cancellation-fee or no-show forfeiture engine was added; current Manager refund
  and retained-advance behavior remains authoritative.
- The in-app browser could not start because of a Windows sandbox ACL error. Requested rendered
  desktop/mobile screenshots and browser-console checks were therefore not produced.
- Production latency and query plans were not measured.

These limitations block the production freeze statement.

## 17. Deployment and rollback

Deployment:

1. Back up `room_bookings`, `room_booking_payments`, `room_booking_refunds`, and room audit tables.
2. Apply `upgrade-manual-room-booking-advance-payment.sql` in staging.
3. Refresh the PostgREST schema cache.
4. Run `node scripts/verify-manual-room-booking-advance-payment.js`.
5. Run all existing Room/PMS/checkout/Staff release verifiers.
6. Run authenticated two-hotel no/partial/full/split/additional/refund/checkout tests.
7. Capture desktop, tablet, and mobile screenshots and verify the browser console.
8. Measure p95 latency and inspect query plans.
9. Promote only after reconciliation equals the payment/refund ledger.

Rollback:

1. Stop advance-bearing booking writes.
2. Export new policy and payment metadata.
3. Deploy the previous backend/frontend build.
4. Apply `rollback-manual-room-booking-advance-payment.sql`.
5. Reapply `upgrade-production-room-pricing-gst.sql` to restore the prior additional-payment RPC.
6. Refresh PostgREST schema cache.
7. Run the original Room booking, payment, refund, checkout, bill, report, and tenant verifiers.

Do not mark this workflow frozen until all deployment gates pass and the owner confirms the freeze.
