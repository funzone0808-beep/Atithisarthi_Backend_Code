"use strict";

const {
  isNotificationCardAllowed,
  resolveNotificationCardKey
} = require("./notification-card-map");

const subscribers = new Set();

function writeEvent(response, eventName, payload) {
  if (response.writableEnded || response.destroyed) return;
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function buildPublicEvent(notificationEvent = {}) {
  const cardKey = resolveNotificationCardKey(notificationEvent);
  return {
    eventId: String(notificationEvent.id || ""),
    eventType: String(notificationEvent.event_type || ""),
    hotelScope: String(notificationEvent.hotel_slug || ""),
    resourceReference: String(notificationEvent.source_id || ""),
    source: String(notificationEvent.source_type || ""),
    status: String(notificationEvent.status || "pending"),
    version: String(notificationEvent.id || ""),
    cardKey,
    createdAt: notificationEvent.created_at || new Date().toISOString()
  };
}

function subscribeToNotificationEvents({ request, response, context }) {
  const subscriber = { response, context };
  subscribers.add(subscriber);
  const heartbeat = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write(": heartbeat\n\n");
  }, 25000);
  const cleanup = () => {
    clearInterval(heartbeat);
    subscribers.delete(subscriber);
  };
  request.once("close", cleanup);
  writeEvent(response, "ready", { connectedAt: new Date().toISOString() });
  return cleanup;
}

function publishNotificationEvent(notificationEvent = {}) {
  const event = buildPublicEvent(notificationEvent);
  if (!event.eventId || !event.hotelScope || !event.cardKey) return 0;
  let delivered = 0;
  subscribers.forEach((subscriber) => {
    if (
      subscriber.context?.hotelSlug !== event.hotelScope ||
      !isNotificationCardAllowed(event.cardKey, subscriber.context)
    ) {
      return;
    }
    writeEvent(subscriber.response, "notification", event);
    delivered += 1;
  });
  return delivered;
}

module.exports = {
  buildPublicEvent,
  publishNotificationEvent,
  subscribeToNotificationEvents
};