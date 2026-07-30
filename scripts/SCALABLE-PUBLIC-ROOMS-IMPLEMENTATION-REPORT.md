# Scalable Public Rooms Discovery — Implementation Report

## Existing public Rooms architecture verified

The public home page previously made one request to `GET /api/public/rooms/:slug`, returned every active physical `rooms` record, joined active `room_types`, loaded every managed/legacy gallery entry into each room DTO, rendered one card per physical room, and booked with a physical `roomId` through `POST /api/public/rooms/:slug/bookings`.

The configured live development tenant (`hotel-sai-raj`) currently contains 3 public physical rooms, 2 active Room Types, and 4 gallery-image references. The legacy payload is 8,506 bytes. The risk at 80–150 rooms was an unbounded physical-room response, one DOM card per room, all gallery metadata in the list response, and one primary image request per card.

The availability path already used the shared booking-overlap and maintenance-block services. Final booking already reloaded the hotel-scoped room, rechecked capacity, booking overlap, maintenance, server pricing, GST/rate-plan snapshots, and the database exclusion constraint. Those authorities remain unchanged.

## Selected scalable architecture

Hybrid discovery is implemented because the data model contains Room Types but booking authority requires a physical `roomId`.

1. Home: up to 6 active hotel-scoped Room Type summaries.
2. Dedicated page: Room Type discovery first.
3. Type selection: server-filtered physical rooms, 12 at a time.
4. Gallery: one room detail request after interaction.
5. Booking: the existing physical-room POST endpoint and transactional checks.

No second availability or booking engine was created.

## Home page behavior

- Heading: Rooms & Suites.
- Initial Rooms request: one compact `mode=types&pageSize=6` request.
- Selection: stable active Room Type order by database ID because the current schema has no public featured/display-order fields.
- Undated counts are labeled as room inventory, not live availability.
- The availability form and Explore All Rooms action preserve hotel, check-in, check-out, adults, and children in the dedicated URL.
- The home page no longer calls the unbounded legacy list on initial load.

## Dedicated Rooms page

Route: `rooms.html` (the project uses static `.html` routes; no framework rewrite layer exists).

Features:

- Hotel-scoped branding and canonical URL.
- Date and guest search.
- Room Type → physical room drill-down.
- Search, min/max price, amenity, bed type, floor, and recommended/price/capacity sorting.
- 12-result Load More pagination.
- Backend-confirmed total count.
- AbortController stale-request cancellation and double-load protection.
- URL state, refresh, Back/Forward, loaded-page reconstruction, and scroll restoration.
- Mobile filter drawer and sticky date/guest summary.
- Empty, error, retry, skeleton, image-failure, and no-availability states.
- Native dialog semantics, keyboard gallery arrows/Escape, focus return, reduced motion, and live regions.

## API changes

### `GET /api/public/rooms/:slug/discovery`

Validated query fields: `mode`, `page`, `pageSize` (maximum 24), `search`, `roomTypeId`, `adults`, `children`, `minPrice`, `maxPrice`, `amenity`, `bedType`, `floor`, `sort`, `checkInDate`, and `checkOutDate`.

Room Type summaries contain only public reference, type ID, name, short description, capacity, starting price, currency, available count/status, one primary image, and up to six amenities.

Physical-room summaries contain only public reference, physical room ID, Room Type label, room name/number, short description, floor, bed type, capacity, trusted starting price, availability status, one primary image, and up to six amenities.

Responses include `page`, `pageSize`, `totalItems`, `totalPages`, and `hasMore`. Availability scanning is bounded to 500 matching physical rooms; page size is capped at 24.

### `GET /api/public/rooms/:slug/rooms/:roomId`

Returns the existing full public room DTO and published gallery only after interaction. It is hotel-scoped, active-only, and available-status-only.

### Compatibility

The old `GET /api/public/rooms/:slug`, old availability route, and booking POST remain available. Existing request and response formats are unchanged. Live availability now uses `private, no-store` rather than a shared 30-second cache.

## Database and cache

The list queries use explicit columns; no new discovery query uses `SELECT *`. Room Type, booking-overlap, maintenance, and primary-image calls are batched, and independent availability calls run concurrently. There is no query per card.

Additive migration:

- `idx_rooms_public_discovery (hotel_slug, is_active, status, room_type_id, room_number)`
- partial `idx_room_bookings_public_active_overlap` for pending, confirmed, and checked-in bookings

The migration was authored but not applied to the configured database.

Stable discovery payloads use a 30-second in-process cache keyed by hotel slug plus validated filters. Live dated availability is never stored in the shared cache. Successful Manager/Admin Room mutations invalidate only `rooms:<hotelSlug>:` entries.

## Image architecture

- List API returns one primary image only.
- Cards emit intrinsic width/height, `srcset`, `sizes`, async decoding, and below-fold lazy loading.
- The first visible card receives high fetch priority.
- Safe fallback renders without layout collapse.
- Full gallery metadata loads only from the detail endpoint after a click.
- One reusable gallery instance is used; adjacent images preload only when Save-Data is off and remaining thumbnails use lazy loading.
- Existing Supabase card/optimized/thumbnail transforms and legacy image fallbacks remain compatible.

## Booking-state preservation

Dates, guests, mode, Room Type, search, filters, sort, and loaded page are encoded in safe URL parameters. Browser state stores scroll position. Gallery open/close fixes and restores the existing scroll position without reloading results. Booking uses the same room ID, idempotency header, server availability checks, pricing, GST, and exclusion constraint as before.

## Tenant isolation

Every discovery, detail, image-metadata, type, room, booking-overlap, maintenance, and cache query is keyed by the trusted resolved hotel slug. Origin/domain access is checked before cached data is returned. Live tests returned 403 for an untrusted Origin, 404 for a different hotel slug with a valid Room ID, 400 for page-size abuse, and 400 for filter injection.

## Performance evidence

Measurements were taken locally against the configured remote development database; they are not production p95 values.

| Metric | Before | After | Target | Result |
|---|---:|---:|---:|---|
| Home Rooms payload | 8,506 B | 814 B | compact | 90.4% smaller |
| Home Rooms median latency (8 runs) | 1,052.7 ms | 209.9 ms | <500 ms | pass locally after warm-up |
| Home initial cards (current tenant) | 3 physical | 2 types (cap 6) | 4–8/cap | pass for available data |
| Home Room API requests | 1 | 1 | bounded | pass |
| Dedicated first-page payload | n/a | 1,201 B | compact | pass |
| Dedicated first-page median (6 final runs) | n/a | 755.2 ms | <750 ms | 5.2 ms above target |
| Dedicated first-page range | n/a | 730.8–1,885.6 ms | <750 ms p95 | not met in remote dev |
| Room detail/gallery payload | legacy list included gallery | 3,621 B on interaction | <750 ms | 1,147.1 ms single run; not met |
| Initial managed images per card | gallery metadata returned | 1 | 1 | pass by API contract |
| Synthetic 100-room legacy vs 12 summaries | 192,611 B | 1,563 B | bounded | 99.2% smaller fixture |

The live tenant has no configured primary Room Type images, so transferred Room image bytes, cache-hit ratio, and image LCP could not be measured meaningfully.

## Scale verification

Automated deterministic pagination passed for 3, 20, 50, 80, 100, and 150 rooms with page sizes `[3]`, `[12,8]`, `[12,12,12,12,2]`, seven pages for 80, nine pages for 100, and thirteen pages for 150. Duplicate references were rejected. Fixtures also passed for 5 Room Types/100 physical rooms and 100 unique physical rooms.

This is a contract/fixture scale test. The configured database was not seeded with 20–150 rooms, so it is not a live database load test.

## Responsive and accessibility

Source-level checks cover one mobile card column, two tablet columns, three desktop columns, 320px fallback, filter drawer/backdrop, sticky mobile summary, real buttons, labels, headings, live result/status regions, intrinsic images, reduced motion, native dialogs, keyboard gallery navigation, and focus return.

Automated in-browser screenshots, screen-reader traversal, touch emulation, Lighthouse, LCP, CLS, DOM-node counts, and mobile-memory measurements were blocked because the in-app browser runtime could not start under the current Windows workspace ACL. No screenshots are claimed.

## Security results

Passed:

- trusted-origin enforcement (403 untrusted origin)
- hotel slug / Room ID mismatch (404)
- hotel-scoped type, room, image metadata, bookings, and maintenance queries
- page-size cap (400)
- filter character validation (400 injection attempt)
- public URL protocol filtering
- active-only Room Types and rooms
- final availability and maintenance revalidation
- server-owned price/GST/rate-plan calculation
- idempotent booking submission
- database overlap constraint regression
- XSS escaping in generated cards and status content
- stable-cache hotel prefix and hotel-only invalidation

Known storage limitation: the established `hotel-assets` bucket returns public image URLs. The API does not disclose another hotel's URLs, but possession or guessing of an already-public object URL cannot be proven inaccessible without migrating the bucket to signed/private delivery.

## Tests

Passed:

- scalable public Rooms verification
- public Room gallery production verification
- public frontend production verification
- Room double-booking safety
- production Room PMS (15/15)
- Room Operations UX/gallery (13/13)
- Room Operations module
- tenant/domain trust guard
- room booking production-gap audit
- JavaScript syntax for all changed scripts/routes
- live legacy route, detail route, cache headers, validation, and tenant checks

Pre-existing release blocker: `verify:frontend-runtime-config` fails because production API/backend environment values are absent and unrelated WhatsApp fallback meta flags do not match the current environment.

## Exact files changed

Existing files:

- `frontend/index.html` — lightweight Room Type preview and Explore action.
- `frontend/js/main.js` — compact home discovery and context-preserving navigation.
- `backend/routes/public-room-booking.js` — compact discovery/detail APIs and shared availability optimization.
- `backend/validators/rooms.js` — bounded discovery query validation.
- `backend/utils/public-route-cache.js` — hotel-scoped Room cache invalidation.
- `backend/routes/admin-room-booking.js` — successful mutation invalidation.
- `backend/routes/staff-room-management.js` — successful Manager mutation invalidation.
- `backend/package.json` — scalable Rooms verification command.

New files:

- `frontend/rooms.html`
- `frontend/css/rooms.css`
- `frontend/js/rooms.js`
- `backend/scripts/upgrade-scalable-public-rooms.sql`
- `backend/scripts/rollback-scalable-public-rooms.sql`
- `backend/scripts/verify-scalable-public-rooms.js`
- `backend/scripts/SCALABLE-PUBLIC-ROOMS-IMPLEMENTATION-REPORT.md`

Restaurant, Orders, KDS, QR, Staff Orders, payments, GST calculation, reports, login, admin/staff HTML, Room checkout, and existing database tables were not edited.

## Rollback plan

No database migration or production deployment was performed.

1. Restore the eight existing changed files from the last deployed/source backup.
2. Remove the six new runtime/migration/test files plus this report.
3. If the index migration is later applied, run `backend/scripts/rollback-scalable-public-rooms.sql`.
4. Restart the backend/static host.
5. Run the legacy public frontend, gallery, double-booking, and production PMS verification commands.

The legacy public Rooms and booking endpoints were never removed, so rolling back the frontend and additive discovery route does not require data conversion.

## Release status

Implementation is complete in the workspace, but this step is **not marked ready to freeze** because browser screenshots/Lighthouse were blocked, the 20–150-room checks are fixture-based rather than live seeded tests, the index migration is not applied, the configured remote development database misses the dedicated-page/detail latency targets, the existing public image bucket cannot guarantee denial by direct URL, and the pre-existing production runtime configuration check fails.
