# Production KDS release runbook

1. Back up `hotel_staff_access`, `orders`, and `order_rounds`.
2. Apply `create-active-order-item-rounds.sql` if needed, then `upgrade-production-kds-workflow.sql`.
3. Restart the backend and sign in again so the trusted `kdsRole` claim is refreshed.
4. Assign `kds_role` as `kitchen`, `expo`, or `general`; owners resolve to manager.
5. Run `npm run verify:production-kds` and `npm run verify:staff-orders-release`.
6. Test one original table KOT and one Round 2 addition; only Round 2 items may appear in the added ticket.
7. Test Kitchen `New -> Preparing -> Ready` and Expo `Ready -> Picked Up / Served` in two browsers.
8. Confirm the table remains active until the existing billing, payment, and release rule closes it.

Rollback: stop traffic, back up new KDS tables, run `rollback-production-kds-workflow.sql`, restart the backend, and restore the prior application build. The rollback does not alter orders, rounds, bills, payments, or tables.
