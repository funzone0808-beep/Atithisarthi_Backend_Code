# Room Booking Production Gap Audit

Status: freeze the safety baseline, not the full product promise.

This audit maps the current codebase against the original room booking prompt. It is intentionally conservative: an item is marked complete only when the repository has visible code, schema, route, UI, and verifier/runbook coverage for that scope.

## Files inspected

- `backend/server.js`
- `backend/routes/public-room-booking.js`
- `backend/routes/admin-room-booking.js`
- `backend/routes/staff-room-booking.js`
- `backend/routes/staff.js`
- `backend/routes/admin.js`
- `backend/middleware/require-staff-auth.js`
- `backend/utils/room-availability.js`
- `backend/utils/room-checkout-summary.js`
- `backend/utils/room-combined-checkout-handler.js`
- `backend/validators/rooms.js`
- `backend/scripts/create-room-booking-tables.sql`
- `backend/scripts/add-order-room-service-columns.sql`
- `backend/scripts/create-room-combined-checkout.sql`
- `backend/scripts/room-booking-conflict-contract.md`
- `backend/scripts/verify-room-double-booking-safety.js`
- `backend/scripts/verify-room-booking-action-permissions.js`
- `backend/scripts/verify-room-checkout-summary.js`
- `backend/scripts/verify-room-combined-checkout-*.js`
- `frontend/js/main.js`
- `frontend/js/admin.js`
- `frontend/js/staff-orders.js`
- `frontend/admin.html`
- `frontend/staff-orders.html`

## Freeze-ready now

- Additive room booking schema exists in `create-room-booking-tables.sql`.
- Feature toggles exist for `enable_food_ordering`, `enable_room_booking`, and `enable_room_service`.
- Public room listing, availability, and booking routes are mounted under `/api/public/rooms`.
- Admin room type, room, availability, booking, status, payment, checkout-summary, and feature-settings routes exist.
- Staff room visibility, availability, manual booking, status, payment, checkout-summary, and combined-checkout routes exist.
- Backend calculates room booking totals and payment balance; frontend price is not trusted for booking creation.
- Backend overlap protection uses shared `[check_in, check_out)` availability logic.
- Database migration includes a PostgreSQL GiST exclusion constraint to prevent active overlapping bookings for the same room.
- Public/admin/staff conflict responses use stable `ROOM_ALREADY_BOOKED`.
- Public/admin/staff frontends preserve and handle `ROOM_ALREADY_BOOKED`.
- Staff financial room actions are manager-only; normal staff can still create manual bookings.
- Staff manager denial includes stable `manager_access_required`.
- Room service order linkage exists through order room fields.
- Checkout summary can combine room charges and linked room-service food charges.
- Combined checkout is implemented behind default-off backend and frontend gates.
- Print/Save PDF style checkout summary exists through browser print windows.
- Verification scripts cover double-booking, action permissions, checkout summary, combined checkout flags, payloads, handler, migration, and runbook readiness.
- Staff Rooms now opens on a same-route Room Operations home with separate New Room Booking and View Room Availability actions.
- Staff availability now has a date-aware operational grid backed by one hotel-scoped response, with lazy booking detail loading so guest information is not placed on room tiles.
- The guided staff booking flow keeps the selected room when availability refreshes, performs final backend revalidation, and refreshes the room grid asynchronously after creation.
- Room status changes now use explicit transition guards; check-in rejects inactive, maintenance, cleaning, or cross-booking conflicts before update.
- Responsive Room Operations contracts and an offline module verifier cover the required home, grid, booking, detail, room-service handoff, tenant, and concurrency hooks.

## Partial, not final-freeze

- Public room booking exists, but public online payment for room bookings is not proven as a complete payment-gateway flow.
- Room photos/images are stored as JSON/URLs, but dedicated room image upload validation is not proven.
- Room reports are partially covered by room summaries and checkout/invoice print views, but there is no dedicated room reports module equivalent to food business reports.
- Combined room plus food checkout exists behind staging/default-off gates, but production enablement still requires staging runbook completion and explicit flag rollout.
- Staff permissions are safe for current owner/staff roles, but granular roles such as kitchen, cashier, receptionist, or housekeeping are not implemented as separate permission classes.
- Public booking confirmation exists at submit response/UI level, but a durable public tracking token for room bookings is not proven.
- Real database application is not proven by repository inspection; SQL migrations still need to be applied and verified against the target Supabase project.
- Authenticated browser QA against real Hotel A and Hotel B data is still required; the local layout preview uses clearly labelled sample room data and is not runtime proof.

## Remaining before full production claim

- Apply `create-room-booking-tables.sql` and `add-order-room-service-columns.sql` to the real database.
- Run schema/readiness verifiers against staging and production-like data.
- Smoke test old flows: food menu, QR ordering, staff ordering, KDS, billing/payment, admin login, staff login, tenant routing, reports.
- Smoke test room flows: add room, manual booking, public booking, overlap conflict, same dates on different rooms, check-in, check-out, cancel, maintenance/inactive exclusion.
- Smoke test tenant isolation with at least Hotel A and Hotel B.
- Decide whether room online payment is required for launch; if yes, add a dedicated room payment gateway flow.
- Add dedicated room reports if client-facing reports are a launch requirement.
- Add room image upload validation if owners need direct file upload instead of image URLs.
- Add granular role permissions if kitchen/reception/cashier access must differ beyond owner versus staff.
- Complete combined checkout staging runbook before enabling production flags.

## Freeze decision

Freeze label: `Room Booking Safety + Permissions Baseline`.

Do not label the entire original prompt as complete yet. The safe baseline is production-minded and preserves existing restaurant flows, but the remaining items above must be handled before calling the whole room booking product fully complete.
