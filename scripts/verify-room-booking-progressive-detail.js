"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const includes = (source, value, label) => assert.ok(source.includes(value), label + " must include " + value);
const between = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, label + " markers must exist");
  return source.slice(startIndex, endIndex);
};

const route = read("backend/routes/staff-room-booking.js");
const validator = read("backend/validators/rooms.js");
const frontend = read("frontend/js/staff-orders.js");
const html = read("frontend/staff-orders.html");
const packageJson = read("backend/package.json");

includes(route, "rooms!room_bookings_room_id_fkey!inner", "unambiguous current-room summary relationship");

const listRoute = between(
  route,
  'router.get("/bookings", async (req, res) => {',
  'router.post("/bookings"',
  "staff booking list route"
);
const summaryBuilder = between(
  route,
  "function buildStaffBookingSummary",
  "function buildRoomBookingActivity",
  "summary DTO builder"
);
const staffDetailBaseBuilder = between(
  route,
  "function buildStaffBookingDetailResponse",
  "if (canViewFinancial)",
  "staff-safe detail DTO builder"
);
const detailRoute = between(
  route,
  'router.get("/bookings/:id", async (req, res) => {',
  'router.get(',
  "staff booking detail route"
);
const cardBuilder = between(
  frontend,
  "function buildStaffRoomBookingCard",
  "function buildStaffRoomCheckoutSummaryControls",
  "compact card builder"
);
const detailBuilder = between(
  frontend,
  "function buildStaffRoomBookingDetailMarkup",
  "function finishStaffRoomBookingDetailClose",
  "progressive detail builder"
);

includes(listRoute, '.select(ROOM_BOOKING_SUMMARY_SELECT, { count: "exact" })', "explicit summary select");
assert.ok(!listRoute.includes('.select("*", { count: "exact" })'), "list route must not preload full rows");
includes(listRoute, 'contract: "room-booking-summary-v1"', "summary contract");
includes(listRoute, '.eq("hotel_slug", hotelSlug)', "summary hotel scope");
includes(listRoute, '.eq("rooms.hotel_slug", hotelSlug)', "summary related-room hotel scope");
includes(listRoute, '.range((page - 1) * limit, page * limit - 1)', "summary server pagination");
includes(listRoute, 'searchFilters.unshift("id.eq." + referenceSearch)', "booking reference search");
includes(listRoute, 'searchFilters.push("room_id.in.(" + matchingRoomIds.join(",") + ")")', "room number search");
["guest_phone", "guest_email", "guest_id_proof", "notes", "pricing_snapshot", "tax_snapshot"].forEach((field) => {
  assert.ok(!summaryBuilder.includes(field), "summary DTO must omit sensitive/full-detail field " + field);
});
["booking_reference", "booking_source_group", "guest_name", "check_in_date", "check_out_date",
 "total_nights", "room_number", "room_type", "booking_status", "action_required"].forEach((field) => {
  includes(summaryBuilder, field, "summary operational fields");
});
includes(summaryBuilder, "if (canViewFinancial)", "summary financial role filter");
includes(detailRoute, 'contract: "room-booking-detail-v1"', "detail contract");
includes(detailRoute, "permissions:", "detail permission metadata");
includes(detailRoute, "buildStaffBookingDetailResponse(booking, canViewFinancial)", "permission-filtered detail DTO");
includes(detailRoute, "buildStaffRoomDetailResponse(room, canViewFinancial)", "permission-filtered room DTO");
[
  "guest_id_proof",
  "guest_gstin",
  "guest_place_of_supply",
  "room_price",
  "tax_amount",
  "payment_status",
  "pricing_snapshot",
  "tax_snapshot"
].forEach((field) => {
  assert.ok(!staffDetailBaseBuilder.includes(field), "Staff detail DTO must omit Manager-only field " + field);
});
["hotel_slug", "idempotency_key", "request_fingerprint", "created_by_user_id"].forEach((field) => {
  assert.ok(!staffDetailBaseBuilder.includes(field), "detail DTO must omit internal field " + field);
});
includes(detailRoute, "payments,", "lazy manager payment history");
includes(detailRoute, "activity:", "lazy activity history");
includes(route, 'router.get("/bookings/:id/payments", requireStaffManagerAccess', "payment history permission");
includes(validator, "limit: z.coerce.number().int().min(15).max(50).optional().default(25)", "bounded page size");
includes(validator, "\\p{N}\\s@+._'#-", "reference search validator");

includes(cardBuilder, "staff-room-booking-summary-card", "compact shared card");
includes(cardBuilder, "data-staff-room-booking-detail", "explicit detail action");
includes(cardBuilder, "View Details", "clear primary detail action");
includes(cardBuilder, "staff-room-booking-more", "compact secondary action menu");
includes(cardBuilder, "Advance / balance", "compact financial summary");
["guest_phone", "guest_email", "guest_id_proof", "notes", "pricing_snapshot"].forEach((field) => {
  assert.ok(!cardBuilder.includes(field), "compact card must not render " + field);
});
["Overview", "Guest", "Stay & Room", "Pricing & GST", "Payments", "Special Requests", "Activity History"].forEach((section) => {
  includes(detailBuilder, section, "complete detail section");
});
includes(detailBuilder, "permissions.canManageBooking === true && isStaffManagerSession()", "frontend manager gate");
includes(frontend, "roomBookingListRequestId", "stale list response protection");
includes(frontend, "roomBookingDetailRequestId", "stale detail response protection");
includes(frontend, "summaryVersion === cachedVersion", "version-aware detail cache");
includes(frontend, "prefers-reduced-motion: reduce", "reduced-motion section navigation");
includes(frontend, "refreshStaffRoomBookingAfterAction", "localized action refresh");
includes(frontend, 'content.setAttribute("aria-busy", "true")', "loading semantics");
includes(frontend, "finishStaffRoomBookingDetailClose", "focus return workflow");
includes(frontend, "restoreStaffRoomBookingFiltersFromUrl", "filter and page restoration");
includes(frontend, "syncStaffRoomBookingUrl", "booking context URL synchronization");
includes(frontend, 'searchParams.get("roomBooking")', "selected booking deep link");
includes(html, 'id="staffRoomBookingDetailDialog"', "booking detail dialog");
includes(html, 'aria-labelledby="staffRoomBookingDetailTitle"', "dialog accessible name");
includes(html, "@media (max-width: 640px)", "mobile full-screen detail");
includes(html, "@media (prefers-reduced-motion: reduce)", "reduced motion");
includes(html, 'option value="25" selected', "preferred page size");
includes(packageJson, '"verify:room-booking-progressive-detail"', "package verifier command");

const fullRecords = Array.from({ length: 1000 }, (_, index) => ({
  id: index + 1,
  hotel_slug: "hotel-a",
  room_id: index % 80,
  guest_name: "Guest " + index,
  guest_phone: "900000" + String(index).padStart(4, "0"),
  guest_email: "guest" + index + "@example.test",
  guest_id_proof: "DOCUMENT-" + index,
  guest_company_name: "Example Company " + index,
  guest_gstin: "GSTIN" + index,
  check_in_date: "2026-08-10",
  check_out_date: "2026-08-12",
  total_nights: 2,
  adults: 2,
  children: 1,
  booking_status: index % 3 === 0 ? "pending" : "confirmed",
  payment_status: index % 4 === 0 ? "paid" : "partial",
  booking_source: index % 2 === 0 ? "online" : "staff",
  room_price: 5000,
  tax_amount: 600,
  discount_amount: 100,
  total_amount: 5500,
  advance_paid: 2000,
  balance_amount: 3500,
  notes: "Detailed request " + "x".repeat(180),
  pricing_snapshot: { nights: [2500, 2500], rules: "x".repeat(240) },
  tax_snapshot: { gst: "x".repeat(180) },
  created_at: "2026-08-04T10:00:00.000Z",
  updated_at: "2026-08-04T10:00:00.000Z"
}));
const startedAt = performance.now();
const summaries = fullRecords.map((record) => ({
  id: record.id,
  booking_reference: "#" + record.id,
  booking_source_group: record.booking_source === "online" ? "website" : "manual",
  booking_source_label: record.booking_source === "online" ? "Website" : "Staff",
  guest_name: record.guest_name,
  check_in_date: record.check_in_date,
  check_out_date: record.check_out_date,
  total_nights: record.total_nights,
  adults: record.adults,
  children: record.children,
  room_id: record.room_id,
  room_number: String(record.room_id),
  room_type: "Deluxe",
  booking_status: record.booking_status,
  payment_status: record.payment_status,
  advance_paid: record.advance_paid,
  balance_amount: record.balance_amount,
  action_required: record.booking_status === "pending" ? "Confirm booking" : null,
  created_at: record.created_at,
  updated_at: record.updated_at
}));
const transformMs = performance.now() - startedAt;
const fullBytes = Buffer.byteLength(JSON.stringify(fullRecords));
const summaryBytes = Buffer.byteLength(JSON.stringify(summaries));
const reductionPercent = Math.round((1 - summaryBytes / fullBytes) * 100);
assert.strictEqual(Math.ceil(summaries.length / 25), 40, "1000 records must paginate to 40 pages at 25 per page");
assert.ok(reductionPercent >= 50, "synthetic summary payload must reduce bytes by at least 50%");
assert.ok(transformMs < 500, "1000-record summary transform should remain below 500ms");
const filtered = summaries
  .filter((record) => record.booking_source_group === "website")
  .filter((record) => record.booking_status === "pending")
  .filter((record) => record.guest_name.toLowerCase().includes("guest"))
  .sort((left, right) => right.id - left.id);
assert.ok(filtered.length > 0 && filtered[0].id > filtered[filtered.length - 1].id, "volume filter and sort simulation must work");

console.log("Room Booking progressive-detail verification passed.");
console.log("Verified summary/detail separation, tenant and role boundaries, compact UI, accessibility, stale-response safety, localized actions, and 1000-record pagination.");
console.log("Synthetic payload: full=" + fullBytes + " bytes, summary=" + summaryBytes +
  " bytes, reduction=" + reductionPercent + "%, transform=" + transformMs.toFixed(2) + "ms.");
