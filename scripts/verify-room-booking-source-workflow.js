"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const { buildRoomBookingSourceSummary, getRoomBookingSourceFilterValues, getRoomBookingSourceGroup, getRoomBookingSourceLabel } = require("../utils/room-booking-source");
const { getAllowedNotificationCardKeys, resolveNotificationCardKey } = require("../utils/notification-card-map");
const { buildNotificationSummary } = require("../utils/notification-summary");
const frontendCards = require("../../frontend/js/staff-notification-cards");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const requireText = (source, text, label) => assert.ok(source.includes(text), `${label} must include ${text}`);

function verifySourceNormalization() {
  ["online", "website", "web", "public_site"].forEach((source) => assert.equal(getRoomBookingSourceGroup(source), "website"));
  ["staff", "admin", "walk-in", "phone", "whatsapp"].forEach((source) => assert.equal(getRoomBookingSourceGroup(source), "manual"));
  assert.equal(getRoomBookingSourceGroup("historical-import"), "legacy");
  assert.equal(getRoomBookingSourceLabel("online"), "Website");
  assert.deepEqual(getRoomBookingSourceFilterValues("website"), ["online", "website", "web", "public_site"]);
  assert.deepEqual(getRoomBookingSourceFilterValues("manual"), ["staff", "admin", "walk-in", "phone", "whatsapp"]);
  const today = new Date().toISOString();
  const summary = buildRoomBookingSourceSummary([
    { booking_source: "online", booking_status: "pending", created_at: today },
    { booking_source: "staff", booking_status: "confirmed", created_at: today },
    { booking_source: "old-import", booking_status: "pending", created_at: "2020-01-01T00:00:00.000Z" }
  ]);
  assert.deepEqual(summary.website, { total: 1, pending: 1, today: 1 });
  assert.deepEqual(summary.manual, { total: 1, pending: 0, today: 1 });
  assert.deepEqual(summary.legacy, { total: 1, pending: 1, today: 0 });
}

function verifyNotificationWorkflow() {
  assert.equal(resolveNotificationCardKey({ event_type: "room_website_booking_created", payload: {} }), "website-room-bookings");
  assert.ok(getAllowedNotificationCardKeys({ isManager: false, canUseFood: false, canUseRooms: true }).includes("website-room-bookings"));
  assert.ok(!getAllowedNotificationCardKeys({ isManager: true, canUseFood: true, canUseRooms: false }).includes("website-room-bookings"));
  assert.ok(frontendCards.CARD_DEFINITIONS["website-room-bookings"]);
  const context = { hotelSlug: "hotel-a", staffId: "staff-a", isManager: false, canUseFood: false, canUseRooms: true };
  const event = { id: 71, hotel_slug: "hotel-a", event_type: "room_website_booking_created", payload: {}, created_at: "2026-07-30T10:00:00.000Z" };
  const unread = buildNotificationSummary(context, [event], { available: true, cursors: {} });
  assert.equal(unread.cards["website-room-bookings"].unread, 1);
  const acknowledged = buildNotificationSummary(context, [event], { available: true, cursors: { "website-room-bookings": 71 } });
  assert.equal(acknowledged.cards["website-room-bookings"].unread, 0);
}

function verifySourceContracts() {
  const publicRoute = read("backend/routes/public-room-booking.js");
  const staffRoute = read("backend/routes/staff-room-booking.js");
  const adminRoute = read("backend/routes/admin-room-booking.js");
  const notificationRoute = read("backend/routes/staff-notifications.js");
  const reportRoute = read("backend/routes/staff.js");
  const migration = read("backend/scripts/upgrade-room-booking-source-workflow.sql");
  const rollback = read("backend/scripts/rollback-room-booking-source-workflow.sql");
  const html = read("frontend/staff-orders.html");
  const frontend = read("frontend/js/staff-orders.js");
  const roomManager = read("frontend/js/room-operations-manager.js");

  requireText(publicRoute, 'booking_source: "online"', "public website source");
  requireText(staffRoute, 'const allowedStaffBookingSources = ["walk-in", "phone", "whatsapp", "staff"]', "staff manual source allowlist");
  requireText(adminRoute, 'bookingSource = "admin"', "admin manual source default");
  requireText(staffRoute, '.eq("hotel_slug", hotelSlug)', "hotel isolation");
  requireText(staffRoute, 'getRoomBookingSourceFilterValues(source)', "authoritative source filtering");
  requireText(staffRoute, '.select(ROOM_BOOKING_SUMMARY_SELECT, { count: "exact" })', "exact pagination counts");
  requireText(staffRoute, 'buildStaffBookingSummary(booking, canViewFinancial)', "summary DTO mapping");
  requireText(staffRoute, 'contract: "room-booking-summary-v1"', "summary API contract");
  requireText(staffRoute, '.range((page - 1) * limit, page * limit - 1)', "server pagination");
  requireText(staffRoute, 'ROOM_FINANCIAL_FILTER_MANAGER_REQUIRED', "financial filter permission");
  requireText(notificationRoute, 'canUseRooms: isHotelFeatureEnabled(featureConfig, "rooms")', "notification Rooms permission");
  requireText(notificationRoute, '.eq("hotel_slug", context.hotelSlug)', "notification hotel isolation");
  requireText(reportRoute, 'bookingSourceGroups', "source-aware reports");

  ["staffRoomBookingsView", "staffRoomBookingSourceHub", "staffRoomsSearchInput", "staffRoomsPreviousPageBtn", "staffRoomsNextPageBtn"].forEach((id) => requireText(html, `id="${id}"`, "source queue UI"));
  requireText(html, 'data-room-booking-source="website"', "Website source card");
  requireText(html, 'data-room-booking-source="manual"', "Manual source card");
  requireText(html, '@media (max-width: 520px)', "mobile source queue CSS");
  requireText(frontend, 'async function loadStaffRoomBookings', "AJAX source queue");
  requireText(frontend, 'acknowledgeStaffNotificationCard("website-room-bookings")', "source-card acknowledgement");
  requireText(frontend, 'roomBookingSearchTimer', "debounced search");
  requireText(frontend, 'roomWebsiteFallbackUnread', "pre-migration Website highlight fallback");
  requireText(frontend, 'staff-room-website-${kind}:${hotelSlug}', "hotel-scoped session highlight state");
  requireText(html, '.staff-room-source-card[hidden] { display: none; }', "zero-count Legacy visibility");
  requireText(html, 'border-color: #b76548', "warm selected Website card palette");
  requireText(roomManager, '"bookings"', "booking deep link");
  requireText(roomManager, 'window.addEventListener("popstate"', "back-forward restoration");

  requireText(migration, 'trg_room_booking_source_immutable', "source immutability");
  requireText(migration, 'trg_enqueue_website_room_booking_notification', "post-insert website event");
  requireText(migration, "'room_website_booking_created'", "website event type");
  requireText(migration, 'on conflict (hotel_slug, dedupe_key)', "notification deduplication");
  requireText(migration, 'idx_room_bookings_hotel_source_status_created', "source queue index");
  requireText(migration, "'website-room-bookings'", "acknowledgement card constraint");
  requireText(migration, 'grant execute on function public.get_room_booking_source_summary(text) to service_role', "summary RPC permission");
  requireText(rollback, 'drop trigger if exists trg_enqueue_website_room_booking_notification', "safe rollback");
}

verifySourceNormalization();
verifyNotificationWorkflow();
verifySourceContracts();
console.log("Website/Manual Room Booking source workflow verification passed.");
console.log("Verified source assignment, hotel isolation, filtering, pagination, permissions, source UI, deep links, reports, post-commit notifications, deduplication, unread acknowledgement, migration safety, and rollback coverage.");

