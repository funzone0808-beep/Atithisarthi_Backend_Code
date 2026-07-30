"use strict";

const NOTIFICATION_CARD_DEFINITIONS = Object.freeze({
  "qr-orders": Object.freeze({
    view: "orders",
    label: "QR Orders",
    eventTypes: Object.freeze(["order_created"]),
    feature: "food",
    managerOnly: false
  }),
  "staff-orders": Object.freeze({
    view: "orders",
    label: "Staff Orders",
    eventTypes: Object.freeze(["order_created"]),
    feature: "food",
    managerOnly: false
  }),
  "website-orders": Object.freeze({
    view: "orders",
    label: "Website Orders",
    eventTypes: Object.freeze(["order_created"]),
    feature: "food",
    managerOnly: false
  }),
  "website-room-bookings": Object.freeze({
    view: "rooms",
    label: "Website Room Bookings",
    eventTypes: Object.freeze(["room_website_booking_created"]),
    feature: "rooms",
    managerOnly: false
  }),
  support: Object.freeze({
    view: "support",
    label: "Support",
    eventTypes: Object.freeze(["support_request_created"]),
    feature: "food",
    managerOnly: false
  }),
  reservations: Object.freeze({
    view: "reservations",
    label: "Reservations",
    eventTypes: Object.freeze(["reservation_created"]),
    feature: "food",
    managerOnly: true
  }),
  inquiries: Object.freeze({
    view: "inquiries",
    label: "Inquiries",
    eventTypes: Object.freeze(["inquiry_created"]),
    feature: "",
    managerOnly: true
  }),
  contacts: Object.freeze({
    view: "contacts",
    label: "Contacts",
    eventTypes: Object.freeze(["contact_submission_created"]),
    feature: "",
    managerOnly: true
  }),
  testimonials: Object.freeze({
    view: "testimonials",
    label: "Reviews",
    eventTypes: Object.freeze(["testimonial_submitted"]),
    feature: "",
    managerOnly: true
  })
});

function normalizeCardText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function resolveOrderNotificationCard(payload = {}) {
  const orderContext =
    payload?.orderContext &&
    typeof payload.orderContext === "object" &&
    !Array.isArray(payload.orderContext)
      ? payload.orderContext
      : {};
  const orderSource = normalizeCardText(
    orderContext.orderSource || payload.orderSource || payload.source || ""
  );
  const orderType = normalizeCardText(orderContext.orderType || payload.orderType || "");

  if (orderSource.includes("qr")) {
    return "qr-orders";
  }

  if (
    orderSource.includes("staff") ||
    orderSource.includes("room-service") ||
    orderType.includes("room-service")
  ) {
    return "staff-orders";
  }

  return "website-orders";
}

function resolveNotificationCardKey(event = {}) {
  const eventType = normalizeCardText(event.event_type || event.eventType || "");
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload
      : {};

  if (eventType === "order-created") {
    return resolveOrderNotificationCard(payload);
  }

  const matchingCard = Object.entries(NOTIFICATION_CARD_DEFINITIONS).find(
    ([, definition]) =>
      definition.eventTypes.some((type) => normalizeCardText(type) === eventType)
  );

  return matchingCard?.[0] || "";
}

function isNotificationCardAllowed(cardKey = "", context = {}) {
  const definition = NOTIFICATION_CARD_DEFINITIONS[normalizeCardText(cardKey)];
  if (!definition) {
    return false;
  }

  if (definition.managerOnly && context.isManager !== true) {
    return false;
  }

  if (definition.feature === "food" && context.canUseFood !== true) {
    return false;
  }

  if (definition.feature === "rooms" && context.canUseRooms !== true) {
    return false;
  }

  return true;
}

function getAllowedNotificationCardKeys(context = {}) {
  return Object.keys(NOTIFICATION_CARD_DEFINITIONS).filter((cardKey) =>
    isNotificationCardAllowed(cardKey, context)
  );
}

module.exports = {
  NOTIFICATION_CARD_DEFINITIONS,
  getAllowedNotificationCardKeys,
  isNotificationCardAllowed,
  normalizeCardText,
  resolveNotificationCardKey,
  resolveOrderNotificationCard
};

