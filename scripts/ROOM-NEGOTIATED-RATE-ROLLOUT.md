# Room Negotiated-Rate Rollout

Status: **SOURCE READY FOR VERIFICATION; DATABASE MIGRATION NOT APPLIED BY CODEX**

Owner authorization: **2026-07-24 ? unfreeze only the Room negotiated-rate scope**

## Reason

Indian hotels frequently agree a one-booking walk-in rate that is lower than the configured rack rate. Editing a Room base price, discount price, or shared rate plan for one guest can accidentally affect public and future bookings. This change adds a booking-level Manager approval instead.

## Compatibility contract

- The negotiated-rate fields are optional and absent from ordinary requests.
- Ordinary Staff, public booking, admin booking, Room configuration, rate plans, QR ordering, Food, KDS, and checkout navigation are unchanged.
- Only an authenticated Manager/Owner can submit a negotiated rate.
- The agreed rate must be greater than zero and cannot exceed any configured nightly rate in the selected stay.
- A reason of at least five characters is mandatory.
- Existing Room GST inclusive/exclusive rules calculate tax on the agreed transaction value.
- The configured pre-discount taxable value remains in `room_price`; the taxable reduction is stored in `discount_amount`; the agreed payable value remains in `total_amount`.
- Pricing version 3 remains the ordinary-booking format. Negotiated bookings use immutable pricing version 4.
- Normal Staff responses remove pricing and tax snapshots as well as direct financial fields.

## Database impact

Apply [`upgrade-room-negotiated-rate.sql`](./upgrade-room-negotiated-rate.sql) before deploying the matching backend/frontend source.

The additive migration creates:

- `room_negotiated_rate_approvals`, an RLS-protected service-role table containing immutable Manager approval evidence;
- an `AFTER INSERT` trigger on `room_bookings` that atomically validates the version-4 snapshot, reconciles booking totals, records approval evidence, and writes `room_operation_audit`;
- `room_negotiated_rate_ready()`, a service-role readiness function used by the API.

No existing booking row is rewritten. No existing table or column is removed.

If the migration is missing or rolled back, only negotiated-rate submissions return `ROOM_NEGOTIATED_RATE_SCHEMA_REQUIRED`; ordinary bookings continue through the previous path.

## Safe deployment order

1. Back up the production database using the normal provider procedure.
2. From `backend`, run `npm run verify:room-negotiated-rate`.
3. Run existing Room regressions listed below.
4. Apply `scripts/upgrade-room-negotiated-rate.sql` in the production database SQL console.
5. Run `npm run verify:room-negotiated-rate-live`.
6. Deploy backend and frontend source together.
7. Sign in as a Manager and perform the live acceptance checks.
8. Ask the owner to confirm behavior before re-freezing this scope.

## Manager workflow

Example: Room 101 configured at ?1,200/night and agreed at ?800/night.

1. Open **Room Operations ? New Room Booking**.
2. Choose Room 101, dates, guest details, and `Walk-in` source.
3. In **Manager negotiated rate**, enable **Apply a special nightly rate to this booking only**.
4. Enter `800` and a meaningful reason such as `Manager-approved repeat guest rate`.
5. Create the booking.
6. Confirm the booking card shows the configured rate, ?800 negotiated rate, discount, reason, total, and balance.

The Room 101 master rate remains ?1,200. Public/future rates do not change.

For multi-night stays, the negotiated value applies to each originally booked night. Existing extension behavior remains unchanged: an extension uses the established Room extension workflow and does not silently extend the original discount.

## GST meaning

The Manager enters the agreed nightly rate using the hotel?s active Room GST mode:

- Exclusive rule: tax is added to the agreed rate.
- Inclusive rule: the agreed rate is the guest-facing inclusive amount and tax is derived from it.
- GST disabled: no tax is added.

GST configuration must be verified with the hotel?s accountant. This feature does not activate or alter GST rules.

## Required verification

From `backend`:

```powershell
npm run verify:room-negotiated-rate
npm run verify:production-room-pms
npm run verify:room-booking-permissions
npm run verify:room-double-booking-safety
npm run verify:room-operations-ux-gallery
npm run verify:staff-orders-ui
```

After migration, with production `.env` configured:

```powershell
npm run verify:room-negotiated-rate-live
npm run verify:production-room-pms-live
```

Live verifiers are read-only.

## Live acceptance checks

- Manager: ?1,200 ? ?800 booking succeeds and preserves the ?1,200 Room configuration.
- Manager: reason is required.
- Manager: a rate above the configured nightly rate is rejected.
- Normal Staff: negotiated controls are hidden and a forged payload returns `403`.
- Public booking: continues using configured pricing and never accepts negotiated fields.
- Booking card, checkout summary, bill, payment, refund, and reports reconcile rack, discount, GST, total, and balance.
- Same-room overlapping booking protection remains active.
- A row exists in both `room_negotiated_rate_approvals` and `room_operation_audit` for the accepted booking.

## Rollback

Apply [`rollback-room-negotiated-rate.sql`](./rollback-room-negotiated-rate.sql), then deploy the prior source version.

The rollback removes the trigger and readiness function, disabling new negotiated-rate submissions. It deliberately preserves approval rows, booking snapshots, and general audit history. Existing negotiated bookings therefore remain financially explainable and continue through checkout, payment, refund, and reporting flows.

## Freeze status

Only this negotiated-rate scope is unfrozen. All other boundaries in [`ROOM-OPERATIONS-FREEZE.md`](./ROOM-OPERATIONS-FREEZE.md) remain frozen. Re-freeze requires successful source checks, read-only live verification after migration, live acceptance, and explicit owner confirmation.
