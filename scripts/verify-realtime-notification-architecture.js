"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const notificationMap = read("backend", "utils", "notification-card-map.js");
const notificationRoute = read("backend", "routes", "staff-notifications.js");
const notificationLive = read("backend", "utils", "notification-live.js");
const notificationUtil = read("backend", "utils", "notifications.js");
const publicRoomRoute = read("backend", "routes", "public-room-booking.js");
const dashboard = read("frontend", "js", "staff-orders.js");
const dashboardHtml = read("frontend", "staff-orders.html");
const migration = read("backend", "scripts", "upgrade-realtime-notification-outbox.sql");

assert.match(notificationMap, /website-room-bookings/);
assert.match(notificationMap, /room_website_booking_created/);
assert.match(notificationRoute, /router\.get\("\/stream", requireStaffAuth/);
assert.match(notificationRoute, /Cache-Control": "no-cache, no-transform/);
assert.match(notificationLive, /isNotificationCardAllowed/);
assert.match(notificationLive, /hotelScope/);
assert.match(notificationUtil, /publishNotificationEvent\(notificationEvent\)/);
assert.match(publicRoomRoute, /sourceType: "room_booking"/);
assert.match(publicRoomRoute, /void createNotificationEventSafely/);
assert.match(dashboardHtml, /js\/staff-realtime-client\.js/);
assert.match(dashboard, /staff:realtime-event/);
assert.match(dashboard, /staff:realtime-state/);
assert.match(dashboard, /staffRealtimeReceivedEventIds/);
assert.match(dashboard, /suppressAlerts/);
assert.doesNotMatch(dashboard, /if \(document\.hidden\) return;\s*void refreshStaffOperationalData/);
assert.match(dashboard, /Background sync active/);
assert.match(dashboard, /AbortController/);
assert.match(migration, /after insert on public\.orders/);
assert.match(migration, /after insert on public\.room_bookings/);
assert.match(migration, /after insert on public\.testimonials/);
assert.match(migration, /website-room-bookings/);

console.log("Real-time notification architecture verification passed.");