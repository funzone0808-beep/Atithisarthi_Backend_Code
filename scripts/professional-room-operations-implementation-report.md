# Professional Manager and Staff Hotel Room Operations — Implementation Report

## 1. Architecture and discovery summary

The project uses Express routes, Supabase/PostgreSQL tables and a static HTML/JavaScript frontend; there is no ORM model layer. The authoritative room foundation is `room_types`, `rooms`, `room_bookings` and `room_booking_payments` from `create-room-booking-tables.sql`.

Files inspected before implementation included:

- `backend/server.js`
- `backend/routes/public-room-booking.js`
- `backend/routes/admin-room-booking.js`
- `backend/routes/staff-room-booking.js`
- `backend/routes/staff.js`
- `backend/routes/admin.js`
- `backend/routes/create-room-checkout-bill-router.js`
- `backend/middleware/require-staff-auth.js`
- `backend/middleware/require-admin-auth.js`
- `backend/middleware/require-hotel-feature.js`
- `backend/utils/auth.js`
- `backend/utils/room-availability.js`
- `backend/utils/room-checkout-summary.js`
- `backend/utils/room-combined-checkout-handler.js`
- `backend/utils/room-checkout-bill.js`
- `backend/validators/rooms.js`
- `backend/scripts/create-room-booking-tables.sql`
- `backend/scripts/create-hotel-staff-access-table.sql`
- `backend/scripts/add-order-room-service-columns.sql`
- `backend/scripts/create-room-combined-checkout.sql`
- all existing `verify-room-*` scripts and the room production gap audit
- `frontend/admin.html`, `frontend/staff-orders.html`
- `frontend/js/main.js`, `frontend/js/admin.js`, `frontend/js/staff-orders.js`
- `frontend/css/style.css` and existing inline Staff Room Operations CSS

Exact pre-existing architecture found:

- Floors were a free-text `rooms.floor` value, not an authoritative master.
- Room types were hotel-scoped and separate from physical rooms.
- Pricing used `rooms.discount_price` then `rooms.base_price`; booking totals and taxes were calculated on the backend.
- Bookings required a physical room; unassigned bookings were not supported by the existing non-null `room_id` contract.
- Availability used one shared helper with the half-open rule `existing.check_in_date < requested.check_out_date AND existing.check_out_date > requested.check_in_date`.
- Pending, confirmed and checked-in bookings blocked availability.
- PostgreSQL GiST exclusion constraint `room_bookings_no_active_overlap` provided the final concurrent double-booking guard.
- Check-in was a booking status transition; no separate durable stay table existed.
- Room shift, date-ranged maintenance, housekeeping task history, rate plans and persisted floor masters did not exist.
- Room service used the existing `orders` table and KDS flow with room and booking linkage.
- Folio/checkout used `buildRoomCheckoutSummary`, room payments and linked food orders; combined checkout remained behind existing default-off gates.
- Hotel Manager was represented by the existing hotel-scoped `owner` credential. Platform Admin used a separate admin token scope. Normal Staff used the `staff` role.
- Staff could view room availability/details and create manual bookings. Existing status, checkout, payment and bill-management actions were Manager-only.

## 2. Implemented architecture

- `hotel_floors`: hotel-scoped floor code, name, order, description and active state.
- `room_types`: expanded with short code, base capacity, extra-adult/child rates and check-in/out times.
- `rooms`: expanded with floor reference, base occupancy, extra beds, smoking policy, display order and notes while preserving free-text floor compatibility.
- `room_rate_plans`: hotel/type-scoped dated plans, weekday applicability, priority, extra guest charges, stay limits, services and cancellation rule.
- `room_bookings`: adds rate-plan reference, immutable pricing snapshot, scoped idempotency key and previous-room reference.
- `hotel_room_amenities`: hotel-scoped amenity master.
- `room_maintenance`: date-ranged room blocks with priority, status, assignment and optional cost.
- `room_housekeeping_tasks`: Dirty, Cleaning, Clean and Inspected workflow.
- `hotel_guest_profiles` and `guest_stays`: hotel-scoped guest/stay foundation; existing booking guest fields remain authoritative for compatibility.
- `room_shifts`: append-only source/target room, upgrade/downgrade, rates, difference, reason and actor history.
- `room_operation_audit`: hotel, actor, action, target, old/new values, reason and timestamp without card/document secrets.
- Manager configuration/daily/shift/extension/report endpoints are mounted at `/api/staff/room-management` while the current Room page and `/api/staff/room-booking` routes remain unchanged.

## 3. Exact files changed

### Existing files modified

- `backend/package.json` — adds the professional Room Operations verifier.
- `backend/server.js` — mounts the additive Manager Room Operations router.
- `backend/routes/public-room-booking.js` — shared rate resolver, maintenance dates and idempotent create.
- `backend/routes/admin-room-booking.js` — same shared pricing/maintenance/idempotency rules for Platform Admin booking.
- `backend/routes/staff-room-booking.js` — same shared rules, floor-group response, validated Staff sources and idempotent create.
- `backend/utils/room-availability.js` — optional date-ranged maintenance conflict helper.
- `backend/scripts/verify-room-combined-checkout-flag.js` — updates the assertion to require the existing stronger combined-billing middleware before checkout.
- `frontend/staff-orders.html` — daily, housekeeping, maintenance, Manager configuration and Room Reports hierarchy on the existing Rooms view.
- `frontend/js/main.js` — public booking idempotency key reuse.
- `frontend/js/admin.js` — Platform Admin manual booking idempotency key reuse.
- `frontend/js/staff-orders.js` — Staff booking idempotency and floor-wise availability rendering.

### New files

- `backend/routes/staff-room-management.js`
- `backend/utils/room-pricing.js`
- `backend/utils/room-idempotency.js`
- `backend/validators/room-operations.js`
- `backend/scripts/upgrade-professional-room-operations.sql`
- `backend/scripts/rollback-professional-room-operations.sql`
- `backend/scripts/verify-professional-room-operations.js`
- `backend/scripts/professional-room-operations-release-runbook.md`
- `backend/scripts/professional-room-operations-implementation-report.md`
- `frontend/js/room-operations-manager.js`
- `frontend/css/room-operations-manager.css`

### Explicitly not modified

Orders, KDS, Take Order, restaurant tables, food pricing/tax calculation, payment gateway/webhooks, login, tenant resolution, feature-toggle behavior, food thermal bill, room thermal bill, checkout summary mathematics, combined-checkout SQL, Dashboard route and public route paths were not replaced or rewritten.

## 4. Database changes and compatibility

The upgrade is additive and must run after `create-room-booking-tables.sql`. It creates the new tables listed above, adds indexes for hotel/date/status lookups and adds nullable/defaulted columns to existing room tables. Existing records remain valid. `rooms.floor` remains populated alongside `floor_id` to preserve old UI/API readers.

Critical constraints and functions:

- unique floor code per hotel
- unique rate plan code per hotel
- unique non-empty room type short code per hotel
- unique booking idempotency key per hotel
- room shift source and target must differ
- maintenance end must be after start
- `shift_room_booking` locks booking, source and target room, rechecks booking/maintenance overlap, records the move and audit atomically
- `extend_room_booking` locks booking/room, rechecks overlap and recalculates the existing average nightly rate/tax atomically
- booking status trigger creates one active stay on check-in and a dirty housekeeping task on checkout
- RPC execute rights are revoked from public/anon/authenticated and granted only to the backend service role

Rollback is `rollback-professional-room-operations.sql`. It preserves the original room, booking, payment, order and bill tables. Export new audit/shift/stay history before rollback if it must be retained.

## 5. Manager permission matrix

The existing hotel `owner` role is the Manager equivalent and remains limited to the JWT hotel slug. It can:

- read daily Room Operations and shared availability
- create hotel-scoped floors, room types, rooms, amenities and rate plans
- update/deactivate configuration when dependency checks pass
- create and complete maintenance blocks
- create and progress housekeeping tasks
- create bookings through the existing workflow
- perform existing Manager-only confirmation, check-in/out, payment, checkout-summary and bill operations
- shift an active checked-in stay atomically
- extend confirmed/checked-in stays atomically
- view hotel-scoped operational/financial Room Reports and safe CSV export

It does not receive the Platform Admin JWT scope or cross-hotel routes.

## 6. Staff permission matrix

Normal Staff can:

- open the existing Room Operations page
- view shared date-aware room availability
- view daily arrivals, departures, active stays, housekeeping and maintenance queues
- create walk-in, phone, WhatsApp or staff-assisted bookings
- enter guest details, use existing room service/KDS integration and print permitted bills
- use only the existing status/payment/checkout operations granted by current middleware

Normal Staff cannot use Manager configuration, Room Reports, shifts, extensions, maintenance/housekeeping mutations, rate changes, room/type/floor changes or Manager financial actions. Backend middleware, not hidden buttons, enforces this.

## 7. Pricing rules

Future booking pricing is resolved on the backend in this order:

1. applicable highest-priority active rate plan covering the stay and weekdays
2. room discount override
3. positive room-specific base override
4. room-type base rate

Extra adults above base occupancy and children use rate-plan prices first, then room-type prices. Tax continues to use the trusted room tax percent. Existing discount/tax fields and response structures remain. Every upgraded booking stores rate source, nightly rate, rate plan, occupancy, extra guest charges, tax and total in `pricing_snapshot`; later rate changes do not mutate it.

The implementation intentionally supports one plan covering the whole stay. It does not blend a different plan per night.

## 8. Availability and booking rules

- Check-in inclusive; checkout exclusive.
- Blocking statuses: pending, confirmed and checked-in.
- Cancelled, checked-out and no-show do not block.
- Operational maintenance/inactive status continues to block according to the existing flow.
- Date-ranged open/in-progress maintenance additionally blocks only overlapping dates.
- All public, Platform Admin and Staff creation routes use the same overlap, maintenance and rate helpers.
- The GiST exclusion constraint remains the final concurrent-write protection.
- Browser clients reuse an `Idempotency-Key`; the database enforces uniqueness per hotel after upgrade.
- Same-day turnover remains valid because ranges use `[)`.

## 9. Room shift and stay extension

Shift requires a checked-in booking, same-hotel target, active/operational target, no booking overlap and no maintenance overlap. The original room is retained in `previous_room_id` and `room_shifts`; the current booking/stay moves to the target. Rate difference and shift kind are backend-calculated. The source receives a dirty housekeeping task. Existing folio/booking identity stays continuous.

Extension requires confirmed or checked-in status, a later checkout and no future overlap. It preserves the paid amount, recalculates nights/room/tax/total/balance and audits old/new checkout and total.

## 10. Housekeeping and maintenance

Housekeeping states are `dirty → cleaning → clean → inspected`. Checkout and room shift create dirty tasks. Housekeeping is stored separately from date booking status.

Maintenance states are open, in progress, completed and cancelled. Open/in-progress date ranges block shared availability. Permanent operational maintenance remains available through the legacy room status for compatibility.

## 11. Payment, folio and room service

The implementation deliberately retains existing financial code:

- room payment rows remain in `room_booking_payments`
- booking advance/balance/payment status remain the checkout source
- linked room-service food orders remain in `orders` and continue through KDS
- `buildRoomCheckoutSummary` remains the folio combination point
- combined checkout remains behind the existing module and default-off backend/frontend flags
- room and food thermal-bill implementations are unchanged

No new refund engine was added because doing so without the target database/payment reconciliation would risk the trusted financial flow.

## 12. Reports and performance

Implemented report summary includes bookings, completed stays, cancellations, no-shows, occupied nights, net room revenue, ADR, payments, shifts and maintenance events. Formula text for occupancy, ADR, RevPAR and average stay is returned. Occupancy/RevPAR are not reported as numeric values until accurate available-room-night calculation is available. CSV output neutralizes formula-leading characters.

Loading changes:

- current availability remains one client API call and lazy booking detail
- daily operations is one client call with six bounded parallel database queries
- Manager configuration is one client call with five parallel scoped queries
- reports are date-limited and capped (2,000 booking/payment rows; 1,000 shift/maintenance rows)
- room search/filter remains in-place and booking/maintenance/housekeeping/shift/extension updates avoid full-page refresh
- floor/type/status/date indexes support new lookup paths

No live query-time or load-time numbers are claimed because the configured Supabase connection failed in this environment.

## 13. Security and tenant isolation

- Staff hotel scope comes only from the verified JWT.
- All resource lookups include both resource id and authenticated hotel slug.
- Floor, type, room and booking references are ownership-checked before mutation.
- Normal Staff booking source is allow-listed.
- Rate and shift difference are backend-calculated.
- Manager boundary is enforced by `requireStaffManagerAccess`.
- Platform Admin remains a separate token scope.
- Guest document storage was not exposed publicly or added to reports.
- Audit avoids payment-card/document values.
- Report CSV injection is neutralized.

## 14. Verification results

Passed repository/offline checks:

- JavaScript syntax for every modified/new backend and frontend file
- professional Room Operations contract verifier
- existing Room Operations verifier
- double-booking safety
- Manager/Staff room booking actions
- checkout summary, validator, adapter, handler, frontend payload and feature gate
- admin/staff combined-checkout UI guards
- Platform Admin separation
- hotel module system
- Staff reports
- Staff Orders UI (330 unique IDs)
- Take Order/KDS regression
- full Staff Orders offline release preflight
- browser DOM/viewport QA at 1440×1000 and 390×844
- zero horizontal overflow at the tested browser sizes
- no preview console warnings/errors

Not passed/proven:

- live room checkout readiness: configured Supabase fetch failed
- live staff-access schema check: configured Supabase fetch failed
- neutral frontend config check: pre-existing explicit feature-policy meta values are nonblank; the source-safe release check passes
- authenticated Manager/Staff/Hotel A/Hotel B browser tests against a real database
- production performance/load test

## 15. Screenshots

Screenshots are representative responsive QA previews with sample data and are not authenticated production evidence:

- `manager-room-operations-qa.png`
- `manager-room-operations-mobile-qa.png`
- `staff-room-operations-mobile-qa.png`

They cover the dashboard hierarchy, floor-wise inventory, availability/status, booking flow, shift/extension attention, housekeeping, maintenance, pricing/configuration and Room Reports in a composite Manager view plus Manager/Staff mobile views.

## 16. Known limitations and freeze decision

- SQL upgrade is authored but not applied to the target database from this environment.
- Live two-hotel tenant isolation, real payment/folio reconciliation and authenticated role QA remain mandatory.
- There is no new public guest-document upload flow.
- Existing non-null booking room assignment remains; unassigned reservations were not introduced to avoid breaking payload/database contracts.
- Rate plans do not blend different nightly rates across one stay.
- Report UI provides summary and safe CSV, not background PDF/Excel generation or every requested analytical report.
- Refund behavior remains the trusted current system; no new refund endpoint was invented.
- Granular per-user permissions beyond the safe Manager/Staff split were not added to the existing binary role architecture.

Therefore the repository implementation is ready for staging migration and authenticated verification, but the production-ready freeze statement must not be issued yet.

## 17. Exact rollback plan

1. Disable the hotel Room module only if immediate containment is required.
2. Back up `hotel_floors`, `room_rate_plans`, `room_maintenance`, `room_housekeeping_tasks`, `hotel_guest_profiles`, `guest_stays`, `room_shifts` and `room_operation_audit`.
3. Deploy the previous application files.
4. Apply `rollback-professional-room-operations.sql`.
5. Reload the PostgREST schema cache and restart the backend.
6. Run all original room booking, checkout, payment, room service, tenant and Staff Orders verifiers.
7. Smoke-test public booking, Staff booking, check-in/out, room service, KDS and thermal bills.

Do not label this module `FROZEN` until the user confirms after all live checks pass.
