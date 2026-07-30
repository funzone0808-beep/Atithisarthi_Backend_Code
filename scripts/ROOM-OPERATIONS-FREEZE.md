# Room Operations Freeze Record

Status: **FROZEN**

Exception: **Room negotiated-rate scope is temporarily UNFROZEN**

Exception authorization date: **2026-07-24**

The exception is limited to the additive, Manager-only booking-level negotiated-rate work described in `ROOM-NEGOTIATED-RATE-ROLLOUT.md`. Every other frozen boundary below remains in force. Owner live confirmation is required before this exception is marked frozen again.

Owner confirmation date: **2026-07-24**

## Frozen scope

- Role-aware Room Operations navigation and reload-free `roomView` deep links.
- Daily Operations, availability, guided booking, housekeeping, maintenance, and Room Service handoff behavior.
- Manager-only paginated inventory, filtering, sorting, table/card layouts, room details, and active/inactive controls.
- Manager Configuration sections for floors, room types, amenities, physical rooms, rates, and Room GST.
- Hotel-scoped room-image storage, upload validation, primary/active rules, ordering, deletion, audit attribution, RLS, and service-role-only RPCs.
- Public active-image filtering, legacy `images_json` fallback, card primary image/count, accessible gallery, thumbnails, keyboard/swipe navigation, fullscreen, focus restoration, and booking-context preservation.
- Additive migration, rollback, source verifier, live verifier, and rollout procedure.

## Protected compatibility boundaries

- Existing Room booking, pricing snapshots, GST snapshots, payment/refund idempotency, bills, shifts, extensions, housekeeping, and maintenance workflows must remain compatible.
- Normal Staff must not gain Manager inventory, media, pricing, tax, reporting, or configuration authority.
- Every Room query and mutation must remain hotel-scoped on the server and in the database.
- Inactive room images and storage paths must never be exposed by public APIs.
- Legacy room and room-type `images_json` values must remain supported until a separately approved migration removes them.
- Dashboard, Food, Take Order, View Tables, Orders, KDS, QR ordering, Reports outside Room Operations, Room Bill, Login, and Table Master are outside this freeze and must not be changed under a Room Operations request.

## Change control

Do not modify the frozen scope during unrelated work.

A future Room Operations change requires:

1. Explicit owner approval to unfreeze the affected scope.
2. A written description of the reason, affected contracts, migration impact, and rollback.
3. Tenant, permission, booking, financial, public-gallery, responsive, and accessibility regression checks proportionate to the change.
4. Read-only live verification after any database migration.
5. Owner confirmation before marking the scope frozen again.

Emergency security fixes may proceed only with explicit authorization and must preserve evidence, rollback instructions, and renewed verification.

## Recorded verification baseline

- `npm run verify:room-operations-ux-gallery` — 13/13 passed.
- `npm run verify:production-room-pms` — 15/15 passed.
- Professional Room Operations verification passed.
- Room double-booking and Room booking permission verification passed.
- Staff Orders UI and Staff release verification passed.
- Changed JavaScript files passed syntax checks.
- Local route smoke test confirmed unauthenticated inventory and media requests return `401`.

The owner subsequently checked the target behavior and approved this freeze.