# Room Combined Checkout Staging Runbook

Use this checklist before enabling atomic room + food combined checkout for any real hotel.

This runbook is staging-only. Do not apply `create-room-combined-checkout.sql` to production from this checklist.

## 1. Confirm the dormant app state

From `backend`, run:

```powershell
npm run verify:room-checkout-preflight
npm run verify:room-checkout-migration
npm run verify:room-checkout-readiness
```

Expected result:

- Combined checkout remains default-off.
- Admin and staff routes are behind `requireRoomCombinedCheckoutEnabled`.
- Admin and staff frontend buttons are disabled by the default frontend runtime flag.
- Frontend combined checkout handlers require the frontend flag, an already-loaded checkout summary, explicit operator confirmation, and the backend feature gate.
- The migration safety contract passes static review.
- The current staging schema has the required room booking and room service columns.

Stop if any check fails.

## 2. Confirm the target database is staging

Before opening the SQL editor:

- Confirm the Supabase project URL is the staging project, not production.
- Confirm recent backups/snapshots exist for the staging project.
- Confirm `ROOM_COMBINED_CHECKOUT_ENABLED=false` in the app environment before migration verification.
- Confirm `ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=false` in frontend runtime config before manual staging checkout.
- Confirm nobody is using this staging project for live hotel operations.

Stop if there is any doubt about the target database.

## 3. Apply the staging migration

In the staging Supabase SQL editor, apply:

```sql
-- backend/scripts/create-room-combined-checkout.sql
```

Expected result:

- `room_checkout_receipts` exists.
- `settle_room_combined_checkout` exists.
- The room service booking-link trigger exists.
- RPC access remains service-role only.

Do not enable the application or frontend feature flags yet.

## 4. Run the staging verifier

From `backend`, with staging Supabase environment values loaded, run:

```powershell
$env:ROOM_CHECKOUT_STAGING_VERIFY="I_UNDERSTAND_STAGING_ONLY"
npm run verify:room-checkout-staging
Remove-Item Env:\ROOM_CHECKOUT_STAGING_VERIFY
```

Expected result:

- The verifier confirms the receipt table is readable.
- The invalid hotel-scope RPC probe is rejected.
- No checkout settlement is created by the probe.

Stop if this verifier fails.

## 5. Enable staging flags for one controlled UI checkout

Only after the staging verifier passes, enable both flags in staging only:

```text
ROOM_COMBINED_CHECKOUT_ENABLED=true
ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=true
```

Expected result:

- Admin and staff `Finalize Combined Checkout` buttons become usable only after a checkout summary is loaded.
- The UI asks for explicit confirmation before posting settlement.
- Backend still validates hotel scope, role permission, strict payload fields, amount, idempotency, and RPC availability.

Stop if either flag points to production.

## 6. Manual staging smoke test plan

Only after both staging flags are enabled:

- Create or use one staging hotel with room booking and room service enabled.
- Create one room and one checked-in booking.
- Place one room service food order with charge-to-room enabled.
- Load admin and staff checkout summaries.
- Confirm room balance, food charges, and final payable match the staging data.
- Click `Finalize Combined Checkout` once from admin or manager staff, confirm the browser prompt, and record the receipt/result.
- Refresh the booking list and confirm the room balance and charge-to-room food status are settled.
- Re-clicking with the same staged flow should not create duplicate settlement because the UI reuses the prepared idempotency key and the backend enforces idempotency.
- Confirm normal food ordering, QR ordering, KDS, manual room payment, and checkout summary printing still work.

Stop if settlement succeeds without confirmation, if totals do not match backend summary, or if any restaurant flow regresses.

## 7. Roll staging flags back down

After the controlled checkout smoke test:

```text
ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=false
ROOM_COMBINED_CHECKOUT_ENABLED=false
```

Expected result:

- Admin and staff `Finalize Combined Checkout` buttons return to disabled.
- `verify:room-checkout-preflight` passes again.
- Production remains unchanged.

## 8. Keep production disabled

After staging verification:

- Keep `ROOM_COMBINED_CHECKOUT_ENABLED=false` in production.
- Keep `ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=false` in production until production enablement is separately approved.
- Do not copy staging SQL changes into production without a separate production rollout window.

## 9. Exit criteria

This staging step is complete only when:

- `verify:room-checkout-preflight` passes.
- `verify:room-checkout-migration` passes.
- `verify:room-checkout-readiness` passes against staging.
- `verify:room-checkout-staging` passes with the explicit staging confirmation variable.
- One confirmed admin or manager-staff staging checkout succeeds with both flags enabled.
- Staging flags are returned to `false` after the checkout smoke test.
- Manual staging smoke tests pass without regressions to food ordering, QR ordering, KDS, billing, admin login, staff login, or tenant isolation.

The next implementation step can prepare a production rollout checklist, still requiring separate approval before enabling either production flag.