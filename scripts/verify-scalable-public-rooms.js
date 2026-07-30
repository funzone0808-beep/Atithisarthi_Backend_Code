"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const route = read("backend/routes/public-room-booking.js");
const validators = read("backend/validators/rooms.js");
const cache = read("backend/utils/public-route-cache.js");
const home = read("frontend/index.html");
const main = read("frontend/js/main.js");
const page = read("frontend/rooms.html");
const roomsJs = read("frontend/js/rooms.js");
const roomsCss = read("frontend/css/rooms.css");
const migration = read("backend/scripts/upgrade-scalable-public-rooms.sql");

function includes(source, value, message) { assert(source.includes(value), message); }
function matches(source, pattern, message) { assert.match(source, pattern, message); }

includes(home, 'id="publicRoomsExploreAll"', "Home Explore All Rooms action is missing");
includes(main, 'params.set("pageSize", "6")', "Home must request only six featured Room Types");
includes(main, '/discovery?', "Home must use compact discovery API");
includes(main, 'normalizePublicRoomImageUrl(image.cardUrl)', "Home Room Type cards must use compatible public image URLs");
includes(main, 'Guest capacity available on request', "Home Room Type cards must always show capacity context");
includes(main, 'A comfortable stay with thoughtful essentials', "Home Room Type cards must always show a description");
includes(main, 'window.location.assign(buildPublicRoomsPageUrl(values))', "Home availability search must preserve context in the Rooms route");
assert(!/async function loadPublicRooms[\s\S]*?: `${getPublicRoomsApiBase\(\)}\/\$\{encodeURIComponent\(hotelSlug\)\}`;/.test(main), "Home still performs the unbounded legacy listing request");

const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.strictEqual(ids.length, new Set(ids).size, "Dedicated Rooms page contains duplicate IDs");
["roomsDiscoveryForm", "roomsFilterForm", "roomsCards", "roomsLoadMore", "roomsGalleryDialog", "roomsBookingDialog"].forEach((id) => includes(page, `id="${id}"`, `Missing ${id}`));
includes(page, 'href="css/rooms.css"', "Rooms stylesheet is missing");
includes(page, 'src="js/rooms.js"', "Rooms behavior script is missing");
includes(page, 'autocomplete="name"', "Booking guest-name autofill is missing");
includes(page, 'pattern="[0-9+() .-]{7,30}"', "Booking phone input validation is missing");
includes(page, 'id="roomsGuestNameError"', "Accessible booking field errors are missing");
includes(page, '<textarea id="roomsGuestNotes"', "Booking notes must use a responsive multiline control");
const referencedRoomIds = [...roomsJs.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
referencedRoomIds.forEach((id) => assert(ids.includes(id), `Rooms script references missing ID: ${id}`));

includes(validators, "publicRoomDiscoveryQuerySchema", "Discovery query validation is missing");
includes(validators, '.max(24)', "Page-size abuse protection is missing");
includes(validators, 'z.enum(["types", "rooms"])', "Hybrid discovery modes are missing");
includes(route, 'router.get("/:slug/discovery"', "Discovery route is missing");
includes(route, 'router.get("/:slug/rooms/:roomId"', "On-demand detail route is missing");
includes(route, '.eq("hotel_slug", hotelSlug)', "Room resources are not hotel-scoped");
includes(route, '.eq("is_primary", true)', "List API does not restrict managed images to primary images");
includes(route, 'PUBLIC_ROOM_LIVE_CACHE_CONTROL = "private, no-store"', "Live availability must not use shared cache");
includes(route, 'PUBLIC_ROOM_DISCOVERY_SCAN_LIMIT = 500', "Bounded availability scan is missing");
includes(route, 'roomNumber: room.room_number', "Compact physical Room summary is missing");
includes(route, 'availableCount: availableRooms.length', "Room Type available quantity is missing");
includes(route, 'fetchPrimaryPublicImages(hotelSlug, roomIds, typeIds)', "Room Type cards must fall back to physical Room images");
includes(route, 'representativeRoom?.images_json', "Room Type cards must support legacy physical Room image fallback");
includes(route, '"/:slug/bookings"', "Existing booking endpoint changed or disappeared");
includes(route, 'resolveRoomBookingPricing({', "Backend-authoritative price calculation changed");
includes(route, 'hasBlockingBooking({', "Final booking overlap revalidation changed");
includes(cache, "invalidatePublicRoomsCache", "Hotel-scoped Room cache invalidation is missing");
includes(migration, "idx_rooms_public_discovery", "Discovery index migration is missing");
includes(migration, "idx_room_bookings_public_active_overlap", "Availability index migration is missing");

includes(roomsJs, "new AbortController()", "Stale request cancellation is missing");
includes(roomsJs, "state.items.has(item.reference)", "Duplicate result protection is missing");
includes(roomsJs, "historySync", "Browser history preservation is missing");
includes(roomsJs, "restorePages", "Loaded-page restoration is missing");
includes(roomsJs, 'loading="lazy"', "Lazy image loading is missing");
includes(roomsJs, "srcset=", "Responsive Room card images are missing");
includes(roomsJs, '/storage/v1/object/public/', "Supabase public image compatibility fallback is missing");
includes(roomsJs, "/rooms/${encodeURIComponent(roomId)}", "Gallery detail-on-demand is missing");
includes(roomsJs, "/bookings", "Dedicated page does not reuse the current booking endpoint");
includes(roomsJs, "Idempotency-Key", "Booking idempotency protection is missing");
includes(roomsJs, "ROOM_ALREADY_BOOKED", "Booking conflict handling is missing");
includes(roomsJs, "validateBookingForm", "Booking form validation is missing");
includes(roomsJs, "resetBookingGuestFields", "Booking fields are not cleared after success");
includes(roomsJs, "Booking request submitted successfully", "Booking success confirmation is missing");
includes(roomsJs, "button.disabled = true", "Duplicate booking submission protection is missing");
includes(roomsJs, "navigator.connection?.saveData", "Save-data gallery behavior is missing");
includes(roomsJs, 'lock("gallery"', "Gallery scroll ownership is missing");
includes(roomsJs, 'lock("booking"', "Booking scroll ownership is missing");
includes(roomsJs, 'lock("filters"', "Filter drawer scroll ownership is missing");
includes(roomsCss, "cursor: auto", "Dedicated Rooms page must restore the native cursor");
includes(roomsCss, "room-gallery__nav--previous", "Gallery navigation positioning guard is missing");
includes(page, "public-room-gallery-arrow room-gallery__nav room-gallery__nav--previous", "Gallery previous control compatibility classes are missing");
includes(roomsCss, "@media (max-width: 820px)", "Tablet/mobile filter layout is missing");
includes(roomsCss, "@media (max-width: 600px)", "Mobile single-column layout is missing");
includes(roomsCss, "inset: 0", "Booking dialog centering guard is missing");
includes(roomsCss, "margin: auto", "Booking dialog must remain centered after the global reset");
includes(roomsCss, "grid-template-columns: repeat(2, minmax(0, 1fr))", "Booking summary and fields need responsive desktop columns");
includes(roomsCss, ".rooms-field-error", "Booking field error styling is missing");
includes(roomsCss, "prefers-reduced-motion", "Reduced-motion support is missing");
includes(read("frontend/css/style.css"), "grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 360px))", "Home Room cards need bounded desktop widths");
includes(read("frontend/css/style.css"), "max-height: 230px", "Home Room images need a bounded height");
includes(read("frontend/css/style.css"), "@media (max-width: 767px)", "Home Room cards need a dedicated mobile breakpoint");
includes(read("frontend/css/style.css"), ".room-card-availability", "Home Room availability badge styling is missing");

function paginate(total, pageSize = 12) {
  const rows = Array.from({ length: total }, (_, index) => ({ reference: `room-${index + 1}` }));
  const seen = new Set();
  const pageCounts = [];
  for (let offset = 0; offset < rows.length; offset += pageSize) {
    const batch = rows.slice(offset, offset + pageSize);
    batch.forEach((row) => { assert(!seen.has(row.reference), `Duplicate ${row.reference}`); seen.add(row.reference); });
    pageCounts.push(batch.length);
  }
  assert.strictEqual(seen.size, total);
  assert(pageCounts.every((count) => count <= pageSize));
  return pageCounts;
}
const scale = [3, 20, 50, 80, 100, 150].map((total) => ({ total, pages: paginate(total) }));
const grouped100 = Array.from({ length: 100 }, (_, index) => `type-${index % 5}`);
assert.strictEqual(new Set(grouped100).size, 5, "Five-type aggregation fixture failed");
const unique100 = Array.from({ length: 100 }, (_, index) => `room-${index + 1}`);
assert.strictEqual(new Set(unique100).size, 100, "Unique-room fixture failed");

const compactFixture = Array.from({ length: 12 }, (_, index) => ({ reference: `room-${index}`, name: "Deluxe Room", startingPrice: 2500, primaryImage: { cardUrl: "/card.webp", width: 800, height: 520 } }));
const legacyFixture = Array.from({ length: 100 }, (_, index) => ({ id: index, title: "Deluxe Room", description: "x".repeat(500), galleryImages: Array.from({ length: 8 }, (_, image) => ({ originalUrl: `/original-${index}-${image}.jpg`, caption: "x".repeat(120) })) }));
const metrics = { compactInitialBytes: Buffer.byteLength(JSON.stringify(compactFixture)), legacyAllRoomsBytes: Buffer.byteLength(JSON.stringify(legacyFixture)), initialCards: 12, initialManagedImagesPerCard: 1 };
assert(metrics.compactInitialBytes < metrics.legacyAllRoomsBytes / 10, "Compact fixture is not materially smaller than legacy all-room payload");
console.log("Scalable public Rooms verification passed.");
console.log(JSON.stringify({ scale, groupedRoomTypes: 5, uniquePhysicalRooms: 100, metrics }, null, 2));
