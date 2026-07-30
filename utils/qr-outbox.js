const { supabase } = require("./supabase");
const logger = require("./logger");
const {
  createNotificationEvent,
  processNotificationEventDeliverySafely
} = require("./notifications");

const DEFAULT_INTERVAL_MS = 2000;
const MAX_BATCH_SIZE = 25;
let timer = null;
let processing = false;

function getRetryDelayMs(attemptCount = 1) {
  return Math.min(5 * 60 * 1000, Math.max(5000, 5000 * (2 ** Math.min(6, attemptCount - 1))));
}

async function claimEvent(event = {}) {
  const attemptCount = Number(event.attempt_count || 0);
  const nextAttemptCount = attemptCount + 1;
  const nextAttemptAt = new Date(Date.now() + getRetryDelayMs(nextAttemptCount)).toISOString();
  const { data, error } = await supabase.from("qr_event_outbox")
    .update({ attempt_count: nextAttemptCount, next_attempt_at: nextAttemptAt, last_error: null })
    .eq("id", event.id)
    .eq("attempt_count", attemptCount)
    .is("published_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findExistingNotification(event = {}) {
  const { data, error } = await supabase.from("notification_events")
    .select("id,status")
    .eq("hotel_slug", event.hotel_slug)
    .eq("source_type", "order")
    .eq("source_id", String(event.aggregate_id || ""))
    .contains("payload", { qrOutboxDeduplicationKey: event.deduplication_key })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function publishClaimedEvent(event = {}) {
  let notificationEvent = await findExistingNotification(event);
  if (!notificationEvent) {
    notificationEvent = await createNotificationEvent({
      hotelSlug: event.hotel_slug,
      sourceType: "order",
      sourceId: event.aggregate_id,
      payload: {
        ...(event.payload && typeof event.payload === "object" ? event.payload : {}),
        eventType: String(event.event_type || "").toLowerCase(),
        qrOutboxEventId: String(event.id || ""),
        qrOutboxDeduplicationKey: event.deduplication_key
      }
    });
    await processNotificationEventDeliverySafely(notificationEvent);
  }
  const publishedAt = new Date().toISOString();
  const { error } = await supabase.from("qr_event_outbox")
    .update({ published_at: publishedAt, next_attempt_at: publishedAt, last_error: null })
    .eq("id", event.id)
    .is("published_at", null);
  if (error) throw error;
}

async function recordFailure(event = {}, error) {
  const message = String(error?.message || "QR outbox delivery failed").slice(0, 1000);
  const { error: updateError } = await supabase.from("qr_event_outbox")
    .update({ last_error: message })
    .eq("id", event.id)
    .is("published_at", null);
  if (updateError) {
    logger.error("QR outbox failure state could not be saved", {
      eventId: event.id,
      message: updateError.message
    });
  }
}

async function processQrOutboxBatch({ limit = MAX_BATCH_SIZE } = {}) {
  if (processing) return { processed: 0, skipped: true };
  processing = true;
  let processed = 0;
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("qr_event_outbox")
      .select("*")
      .is("published_at", null)
      .lte("next_attempt_at", now)
      .order("id", { ascending: true })
      .limit(Math.min(MAX_BATCH_SIZE, Math.max(1, Number(limit || MAX_BATCH_SIZE))));
    if (error) throw error;
    for (const candidate of data || []) {
      let claimed = null;
      try {
        claimed = await claimEvent(candidate);
        if (!claimed) continue;
        await publishClaimedEvent(claimed);
        processed += 1;
      } catch (eventError) {
        await recordFailure(claimed || candidate, eventError);
        logger.warn("QR outbox event will retry", {
          eventId: candidate.id,
          hotelSlug: candidate.hotel_slug,
          eventType: candidate.event_type,
          message: eventError.message
        });
      }
    }
    return { processed, skipped: false };
  } finally {
    processing = false;
  }
}

function startQrOutboxWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (timer) return timer;
  const safeInterval = Math.max(1000, Number(intervalMs || DEFAULT_INTERVAL_MS));
  timer = setInterval(() => {
    void processQrOutboxBatch().catch((error) => {
      logger.error("QR outbox batch failed", { message: error.message });
    });
  }, safeInterval);
  timer.unref?.();
  void processQrOutboxBatch().catch((error) => {
    logger.error("Initial QR outbox batch failed", { message: error.message });
  });
  return timer;
}

function stopQrOutboxWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  processQrOutboxBatch,
  startQrOutboxWorker,
  stopQrOutboxWorker
};
