# Room Booking Compact Summary and Progressive Detail — Implementation Report

Date: 2026-08-04  
Scope: Staff Room Operations → Room Bookings  
Freeze status: implemented in source and regression-verified; not permanently frozen or deployed by this change.

## Architecture before and after

Before:

- Website and Manual Bookings already used separate source queues, hotel-scoped server filters, and pagination.
- GET /api/staff/room-booking/bookings selected full room_bookings rows.
- Queue cards rendered contact data, notes, financial controls, refund controls, and checkout controls inline.
- The existing single-booking endpoint was used by Room Availability, but Room Bookings had no progressive-detail UI.

After:

- Website and Manual Bookings remain separate operational queues.
- Both queues use the same compact summary DTO, card renderer, detail service, and drawer.
- The list endpoint selects an explicit operational field set and returns room-booking-summary-v1.
- Full authorized data, payments, refunds, and activity load only from room-booking-detail-v1 when opened.
- List and detail requests use independent stale-response counters.
- Successful status, payment, and refund actions refresh the booking queue and open detail only; unrelated Room Operations, food orders, KDS, and QR flows are not reloaded.
- Summary joins require the related Room row to match the authenticated hotel scope.
- Detail responses use explicit Staff/Manager allowlists; internal tenant, idempotency, request-fingerprint, and creator identifiers are not returned by the detail DTO.
- Booking updated_at is the response version, so the in-memory detail cache is reused only when the current summary version matches.

## Compact summary fields

Always available to authorized Room staff:

- booking ID/reference
- normalized source group and label
- guest display name
- check-in/check-out dates and total nights
- adult/child counts
- assigned room ID/number, room type, and floor
- booking status
- created/updated time
- computed action-required label

Manager-only summary fields:

- payment status
- advance paid
- balance amount
- booking version (updated_at)

The summary DTO intentionally omits phone, email, identity proof, notes, company tax details, full pricing snapshots, and GST snapshots.

## Detail architecture

A dedicated native dialog is used as a right-side drawer on desktop/tablet and a full-screen workflow on mobile. It contains:

1. Overview
2. Guest
3. Stay & Room
4. Pricing & GST
5. Payments
6. Special Requests
7. Activity History
8. Management Actions (Manager only)

The drawer opens with loading skeletons, exposes aria-busy, has an accessible name and description, supports Escape/cancel, and returns focus to the latest matching summary-card trigger after local list refresh.

Collapsed cards use View Details as the primary action and a compact keyboard-accessible overflow menu for section shortcuts. Manager-only payment/action shortcuts are omitted from Staff cards. The selected card remains visibly marked while its drawer is open.

## APIs and permissions

Summary list — GET /api/staff/room-booking/bookings:

- authenticated Staff route and Room feature gate
- hotel scope derived from the staff session
- source/status/payment/date/search/sort validation
- booking reference search supported with numeric IDs or #ID
- payment filter/sort restricted to Manager
- server pagination: 15–50 allowed, 25 default
- Cache-Control: private, no-store
- response contract: room-booking-summary-v1

Detail — GET /api/staff/room-booking/bookings/:id:

- authenticated Staff route
- hotel ID never accepted from the client
- booking and room re-resolved inside the session hotel scope
- response contract: room-booking-detail-v1
- ordinary Staff receive operational/guest-contact detail with financial fields removed
- Managers receive financial fields, payment history, refund history, and available operation audit history
- identity proof is Manager-only
- Cache-Control: private, no-store

Financial history — GET /api/staff/room-booking/bookings/:id/payments:

- explicitly protected by requireStaffManagerAccess
- booking and payment rows are both hotel scoped

Mutation endpoints retain their existing server-side validation, idempotency, transition, overlap, pricing, GST, and Manager permission rules.

## Website and Manual Booking behavior

- Website source card continues to acknowledge unread website booking notifications.
- Manual source card continues to represent walk-in, phone, WhatsApp, staff, and admin-assisted sources.
- Source switching resets to page 1 and keeps independent server filtering.
- Both queues render the same component structure and open the same detail workflow.
- Source-specific accent and labels remain visible; records are never merged into one ambiguous queue.

## AJAX and local update behavior

- Debounced search remains at 300 ms.
- Filters and source changes issue new server requests without full-page reload.
- A later list request invalidates earlier responses, preventing rapid changes from showing stale data.
- A later detail request or drawer close invalidates earlier detail responses.
- Status, payment, and refund success refresh only the booking list and current detail.
- List filter values, selected source, current page, and scroll context remain while the drawer is open.
- Source, filters, sort, page size, page, and selected booking are synchronized to the existing Room Operations URL so refresh and Back/Forward restore operational context.
- Cached details are invalidated when the summary version changes.

## Security and privacy

- No client-supplied hotel slug is trusted.
- List and detail reads apply hotel_slug from authenticated staff context.
- Financial filtering, payment history, financial detail, and management actions are Manager-only.
- Compact cards do not render phone, email, identity proof, notes, or pricing/GST snapshots.
- Booking IDs are re-authorized on every detail and action endpoint.
- Related Room rows are re-scoped to the authenticated hotel in summary and detail reads.
- Staff detail JSON omits identity proof, company GST fields, all financial fields, pricing/tax snapshots, and internal persistence fields at the API boundary rather than merely hiding them in the browser.
- Existing conflict-safe transitions, server pricing, idempotent payments/refunds, and double-booking protection are unchanged.

## Performance evidence

Dedicated 1,000-record verification:

- default page size: 25
- simulated pages: 40
- synthetic full payload: approximately 1,322,296 bytes
- synthetic summary payload: approximately 483,841 bytes
- payload reduction: 63%
- summary transform: approximately 2–3 ms

These are deterministic synthetic repository benchmarks, not production network latency measurements. Live Railway/Supabase latency remains a deployment-stage check.

Read-only configured-database measurement after the final tenant-safe relationship qualification (10 iterations, 17 available first-page rows):

- summary query p50: 180.67 ms
- summary query p95: 488.67 ms
- Manager detail query shape p50: 361.58 ms
- Manager detail query shape p95: 648.44 ms
- previous full-row list payload: 47,900 bytes
- shaped summary DTO payload: 7,189 bytes
- measured payload reduction: 85%

This measures database round trips and response shaping only; it is not an authenticated browser end-to-end timing and does not include DOM/render duration.

## Responsive and accessibility behavior

- desktop: compact three-column row and right-side detail drawer
- tablet: summary actions move to a second row
- mobile: single-column cards and full-screen detail workflow
- native dialog focus containment
- explicit accessible dialog label/description and focusable heading
- Escape/cancel close behavior and focus return
- live loading/error regions and aria-busy
- reduced-motion handling
- touch-sized detail action

## Verification completed

Passed:

- JavaScript syntax checks for backend route, validator, and frontend
- Room Booking action permissions
- Website/Manual source workflow
- progressive detail contract/security/volume/performance
- Room Operations module
- double-booking safety
- manual booking advance payment
- checkout summary
- negotiated rate
- Staff Orders UI
- Professional Room Operations
- Production Room PMS: 15/15

Broader Staff Orders release preflight:

- all 16 release checks passed, including the explicitly configured frontend runtime mode
- the verifier was supplied process-only values matching the already-stamped production metadata
- no runtime metadata, source file, Railway setting, or Cloudflare setting was changed by this verification

## Screenshot evidence

Automated screenshot capture was attempted through the installed in-app browser workflow. The browser runtime could not start because the Windows sandbox helper returned an ACL read error before a browser session was created. No misleading or synthetic screenshot is attached. Source-level responsive contracts and UI regression checks passed; authenticated local/staging screenshots remain a release-stage evidence item.

## Limitations and deployment gates

- changes are local source changes; no Cloudflare Worker or Railway deployment was performed
- authenticated staging smoke test is required after deployment
- live two-hotel tenant isolation should be exercised with real staging accounts
- production latency and database query plans should be observed after rollout
- the broad offline Staff Orders release preflight is green; authenticated responsive and end-to-end browser QA is still required before production sign-off

## Rollback plan

No database migration is required.

To roll back:

1. restore the previous Room Booking list select/response in backend/routes/staff-room-booking.js
2. restore the previous list limit in backend/validators/rooms.js
3. restore the previous card/list renderer and handlers in frontend/js/staff-orders.js
4. remove the detail dialog and compact/progressive CSS from frontend/staff-orders.html
5. remove the progressive-detail verifier command and script
6. rerun existing Room Booking, Staff Orders UI, Professional Room Operations, and Production Room PMS verifiers

Existing bookings, payments, refunds, pricing snapshots, GST snapshots, notifications, and audit rows are not changed by this rollback.

## Files changed

- backend/routes/staff-room-booking.js
- backend/validators/rooms.js
- frontend/js/staff-orders.js
- frontend/staff-orders.html
- backend/scripts/verify-room-booking-action-permissions.js
- backend/scripts/verify-room-booking-source-workflow.js
- backend/scripts/verify-room-booking-progressive-detail.js
- backend/package.json
- backend/scripts/room-booking-progressive-detail-implementation-report.md
