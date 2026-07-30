"use strict";

function buildNotificationDedupeKey({
  sourceType = "",
  sourceId = "",
  eventType = "",
  payload = {}
} = {}) {
  const payloadEventType = String(payload?.eventType || eventType || "created")
    .trim()
    .toLowerCase();
  const eventVersion = String(
    payload?.eventVersion ||
      payload?.version ||
      payload?.roundSequence ||
      payload?.gatewayEventId ||
      ""
  ).trim();

  return [sourceType, sourceId, payloadEventType, eventVersion]
    .map((part) => String(part || "").trim().toLowerCase())
    .join(":");
}

function isMissingNotificationDedupeColumnError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .toLowerCase();

  return (
    code === "42703" ||
    code === "PGRST204" ||
    (details.includes("dedupe_key") &&
      (details.includes("does not exist") ||
        details.includes("could not find") ||
        details.includes("schema cache")))
  );
}

function isNotificationDedupeConflict(error) {
  return String(error?.code || "").trim() === "23505";
}

module.exports = {
  buildNotificationDedupeKey,
  isMissingNotificationDedupeColumnError,
  isNotificationDedupeConflict
};
