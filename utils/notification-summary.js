"use strict";

const {
  NOTIFICATION_CARD_DEFINITIONS,
  getAllowedNotificationCardKeys,
  isNotificationCardAllowed,
  resolveNotificationCardKey
} = require("./notification-card-map");

const NOTIFICATION_EVENT_WINDOW = 500;

function buildNotificationSummary(context = {}, events = [], acknowledgement = {}) {
  const cardKeys = getAllowedNotificationCardKeys(context);
  const cards = Object.fromEntries(
    cardKeys.map((cardKey) => {
      const acknowledgedThroughId = Math.max(
        0,
        Number(acknowledgement.cursors?.[cardKey] || 0) || 0
      );
      return [
        cardKey,
        {
          view: NOTIFICATION_CARD_DEFINITIONS[cardKey].view,
          label: NOTIFICATION_CARD_DEFINITIONS[cardKey].label,
          unread: 0,
          unreadEventIds: [],
          unreadIsLowerBound: false,
          acknowledgedThroughId,
          latestAt: null,
          latestEventId: 0
        }
      ];
    })
  );
  const recentEvents = [];
  let version = 0;

  [...events].reverse().forEach((event) => {
    const eventId = Math.max(0, Number(event.id || 0) || 0);
    const cardKey = resolveNotificationCardKey(event);
    const card = cards[cardKey];

    if (!card || !isNotificationCardAllowed(cardKey, context)) {
      return;
    }

    version = Math.max(version, eventId);
    card.latestEventId = Math.max(card.latestEventId, eventId);
    card.latestAt = event.created_at || card.latestAt;

    if (eventId > card.acknowledgedThroughId) {
      card.unread += 1;
      card.unreadEventIds.push(eventId);
      recentEvents.push({
        id: eventId,
        eventType: event.event_type || "",
        cardKey,
        view: card.view,
        createdAt: event.created_at || ""
      });
    }
  });

  const truncated = events.length >= NOTIFICATION_EVENT_WINDOW;
  const oldestWindowEventId = events.reduce(
    (oldest, event) => Math.min(oldest, Math.max(0, Number(event.id || 0) || 0)),
    Number.POSITIVE_INFINITY
  );
  if (truncated && Number.isFinite(oldestWindowEventId)) {
    Object.values(cards).forEach((card) => {
      card.unreadIsLowerBound =
        card.unread > 0 && card.acknowledgedThroughId < oldestWindowEventId;
    });
  }

  return {
    success: true,
    hotelSlug: context.hotelSlug,
    version,
    generatedAt: new Date().toISOString(),
    acknowledgementAvailable: acknowledgement.available === true,
    truncated,
    cards,
    recentEvents: recentEvents.slice(-50)
  };
}

module.exports = {
  NOTIFICATION_EVENT_WINDOW,
  buildNotificationSummary
};
