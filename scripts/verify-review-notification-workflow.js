"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  getAllowedNotificationCardKeys,
  resolveNotificationCardKey
} = require("../utils/notification-card-map");
const { buildNotificationDedupeKey } = require("../utils/notification-dedupe");
const reviewAvatar = require("../../frontend/js/review-avatar");
const frontendCards = require("../../frontend/js/staff-notification-cards");
const { buildNotificationSummary } = require("../utils/notification-summary");

const root = path.join(__dirname, "..", "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

function verifyAvatarResolver() {
  assert.strictEqual(
    reviewAvatar.resolveReviewAvatar("").src,
    reviewAvatar.DEFAULT_REVIEW_AVATAR_SRC
  );
  assert.strictEqual(
    reviewAvatar.resolveReviewAvatar("javascript:alert(1)").isDefault,
    true
  );
  assert.strictEqual(
    reviewAvatar.resolveReviewAvatar("data:image/svg+xml,bad").isDefault,
    true
  );
  assert.strictEqual(
    reviewAvatar.resolveReviewAvatar("https://cdn.example.test/guest.webp").src,
    "https://cdn.example.test/guest.webp"
  );

  const listeners = {};
  const image = {
    dataset: {},
    src: "https://cdn.example.test/missing.webp",
    alt: "Guest",
    getAttribute(name) {
      return name === "src" ? this.src : "";
    },
    addEventListener(name, listener) {
      listeners[name] = listener;
    }
  };
  reviewAvatar.bindReviewAvatar(image);
  listeners.error({ currentTarget: image });
  assert.strictEqual(image.src, reviewAvatar.DEFAULT_REVIEW_AVATAR_SRC);
  assert.strictEqual(image.dataset.reviewAvatarFallbackApplied, "true");
  const fallbackSrc = image.src;
  listeners.error({ currentTarget: image });
  assert.strictEqual(image.src, fallbackSrc, "fallback must not recurse");

  const avatarPath = path.join(root, "frontend", "img", "default-review-avatar.v1.svg");
  const avatarStat = fs.statSync(avatarPath);
  assert(avatarStat.size < 4096, `default avatar should stay lightweight (${avatarStat.size} bytes)`);
  const avatarSource = fs.readFileSync(avatarPath, "utf8");
  assert.match(avatarSource, /width="128" height="128"/);
  assert.match(read("frontend/_headers"), /\/img\/\*[\s\S]*max-age=86400/);
}

function verifyCardRegistry() {
  const backendKeys = getAllowedNotificationCardKeys({
    isManager: true,
    canUseFood: true,
    canUseRooms: true
  }).sort();
  const frontendKeys = Object.keys(frontendCards.CARD_DEFINITIONS).sort();
  assert.deepStrictEqual(frontendKeys, backendKeys);

  const resolve = (eventType, payload = {}) =>
    resolveNotificationCardKey({ event_type: eventType, payload });
  assert.strictEqual(resolve("order_created", { orderContext: { orderSource: "qr" } }), "qr-orders");
  assert.strictEqual(resolve("order_created", { orderContext: { orderSource: "staff" } }), "staff-orders");
  assert.strictEqual(resolve("order_created", { orderContext: { orderType: "room_service" } }), "staff-orders");
  assert.strictEqual(resolve("order_created"), "website-orders");
  assert.strictEqual(resolve("support_request_created"), "support");
  assert.strictEqual(resolve("reservation_created"), "reservations");
  assert.strictEqual(resolve("inquiry_created"), "inquiries");
  assert.strictEqual(resolve("contact_submission_created"), "contacts");
  assert.strictEqual(resolve("testimonial_submitted"), "testimonials");
  assert.strictEqual(resolve("room_website_booking_created"), "website-room-bookings");

  assert.deepStrictEqual(
    getAllowedNotificationCardKeys({ isManager: false, canUseFood: true, canUseRooms: true }).sort(),
    ["qr-orders", "staff-orders", "support", "website-orders", "website-room-bookings"].sort()
  );
  assert.deepStrictEqual(
    getAllowedNotificationCardKeys({ isManager: true, canUseFood: false, canUseRooms: false }).sort(),
    ["contacts", "inquiries", "testimonials"].sort()
  );
}

function verifyNotificationSummaryCounts() {
  const context = {
    hotelSlug: "hotel-one",
    staffId: "staff-one",
    isManager: true,
    canUseFood: true
  };
  const events = [
    { id: 30, event_type: "order_created", payload: { orderContext: { orderSource: "qr" } }, created_at: "2026-07-29T10:03:00.000Z" },
    { id: 29, event_type: "order_created", payload: { orderContext: { orderSource: "staff" } }, created_at: "2026-07-29T10:02:00.000Z" },
    { id: 28, event_type: "order_created", payload: { orderContext: { orderSource: "qr" } }, created_at: "2026-07-29T10:01:00.000Z" },
    { id: 27, event_type: "testimonial_submitted", payload: {}, created_at: "2026-07-29T10:00:00.000Z" }
  ];
  const summary = buildNotificationSummary(context, events, {
    available: true,
    cursors: { "qr-orders": 28, "staff-orders": 29 }
  });

  assert.strictEqual(summary.hotelSlug, context.hotelSlug);
  assert.strictEqual(summary.cards["qr-orders"].unread, 1);
  assert.deepStrictEqual(summary.cards["qr-orders"].unreadEventIds, [30]);
  assert.strictEqual(summary.cards["qr-orders"].acknowledgedThroughId, 28);
  assert.strictEqual(summary.cards["staff-orders"].unread, 0);
  assert.strictEqual(summary.cards.testimonials.unread, 1);
  assert.strictEqual(summary.version, 30);

  const truncatedEvents = Array.from({ length: 500 }, (_, index) => ({
    id: 1000 - index,
    event_type: "order_created",
    payload: { orderContext: { orderSource: "qr" } },
    created_at: "2026-07-29T10:00:00.000Z"
  }));
  const truncatedSummary = buildNotificationSummary(context, truncatedEvents, {
    available: true,
    cursors: {}
  });
  assert.strictEqual(truncatedSummary.cards["qr-orders"].unread, 500);
  assert.strictEqual(truncatedSummary.cards["qr-orders"].unreadIsLowerBound, true);
  assert.strictEqual(truncatedSummary.truncated, true);
}

function verifyNotificationIdempotency() {
  const input = {
    sourceType: "testimonial",
    sourceId: "42",
    eventType: "testimonial_submitted",
    payload: { testimonialId: 42 }
  };
  assert.strictEqual(buildNotificationDedupeKey(input), buildNotificationDedupeKey(input));
  assert.notStrictEqual(
    buildNotificationDedupeKey({
      sourceType: "order",
      sourceId: "10",
      payload: { eventType: "order_items_added", roundSequence: 2 }
    }),
    buildNotificationDedupeKey({
      sourceType: "order",
      sourceId: "10",
      payload: { eventType: "order_items_added", roundSequence: 3 }
    })
  );

}

function verifySourceContracts() {
  const publicRoute = read("backend/routes/public.js");
  const staffRoute = read("backend/routes/staff.js");
  const staffNotificationRoute = read("backend/routes/staff-notifications.js");
  const notificationSummaryUtility = read("backend/utils/notification-summary.js");
  const notificationUtility = read("backend/utils/notifications.js");
  const staffFrontend = read("frontend/js/staff-orders.js");
  const publicFrontend = read("frontend/js/main.js");
  const staffHtml = read("frontend/staff-orders.html");
  const upgradeSql = read("backend/scripts/upgrade-review-card-notifications.sql");

  assert.match(publicRoute, /\.eq\("is_approved", true\)/);
  assert.match(publicRoute, /item\.is_approved === true/);
  assert.match(staffRoute, /invalidatePublicTestimonialsCache\(hotelSlug\)/);
  assert.match(staffRoute, /\.eq\("hotel_slug", hotelSlug\)/);
  assert.match(staffRoute, /\.eq\("updated_at", currentUpdatedAt\)/);
  assert.match(staffRoute, /testimonial_changed/);
  assert.match(staffRoute, /moderationAction/);
  assert.match(staffRoute, /requestedAction === "reject"/);
  assert.match(staffRoute, /is_archived: requestedAction === "reject"/);
  assert.match(staffFrontend, /data-testimonial-action="reject"/);
  assert.match(staffFrontend, /Review rejected and removed from public eligibility/);
  assert.match(staffNotificationRoute, /\.eq\("hotel_slug", context\.hotelSlug\)/);
  assert.match(staffNotificationRoute, /\.eq\("staff_id", context\.staffId\)/);
  assert.match(staffNotificationRoute, /isNotificationCardAllowed\(cardKey, context\)/);
  assert.match(staffNotificationRoute, /private, no-store/);
  assert.match(notificationSummaryUtility, /unreadEventIds/);
  assert.match(notificationSummaryUtility, /unreadIsLowerBound/);
  assert.match(staffNotificationRoute, /acknowledge_notification_card/);
  assert.match(staffFrontend, /acknowledgedThroughId: latestEventId/);
  assert.match(staffFrontend, /previousCard/);
  assert.match(staffFrontend, /notification_acknowledgements_not_ready/);
  assert.match(staffFrontend, /In range|formatStaffCount/);
  assert.match(notificationUtility, /dedupe_key: buildNotificationDedupeKey/);
  assert.match(upgradeSql, /unique \(hotel_slug, staff_id, card_key\)/i);
  assert.match(upgradeSql, /idx_notification_events_hotel_dedupe/);
  assert.match(upgradeSql, /greatest\([\s\S]*acknowledged_through_id/i);

  assert.match(publicFrontend, /data-review-avatar/);
  assert.match(publicFrontend, /bindReviewAvatars\(card\)/);
  assert.match(staffFrontend, /notificationSeenEventKeys/);
  assert.match(staffFrontend, /notificationSummaryInitialized && version < STAFF_STATE\.notificationSummaryVersion/);
  assert.match(staffFrontend, /STAFF_SOUND_ALERT_THROTTLE_MS = 1200/);
  assert.match(staffFrontend, /createDynamicsCompressor/);
  assert.match(staffFrontend, /low: 0\.1[\s\S]*medium: 0\.16[\s\S]*high: 0\.22/);
  assert.doesNotMatch(staffFrontend, /gain\.exponentialRampToValueAtTime\(1(?:\.0+)?,/);
  assert.match(staffHtml, /id="staffSoundVolumeSelect"/);
  assert.match(staffHtml, /staff-view-tab-activity/);
  assert.match(staffHtml, /@media \(prefers-reduced-motion: reduce\)/);
}

verifyAvatarResolver();
verifyCardRegistry();
verifyNotificationSummaryCounts();
verifyNotificationIdempotency();
verifySourceContracts();

console.log("Review avatar, card notifications, and audio workflow verification passed.");


