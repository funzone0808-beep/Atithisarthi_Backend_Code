"use strict";

const crypto = require("crypto");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const EXPECTED_BACKEND = "https://atithisarthibackendcode-production-0e4f.up.railway.app";
const INTENT_ID = "c2c14dda-f6ab-4548-8e2a-06612ef05237";
const ORDER_ID = "261";
const EVENT_ID = "TEST_TASK2B_VERIFY_THEN_WEBHOOK_pay_TgAQVagsZt1aVs_v1";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function postWebhook(rawBody, signature) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${EXPECTED_BACKEND}/api/payments/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-event-id": EVENT_ID,
        "x-razorpay-signature": signature
      },
      body: rawBody,
      signal: controller.signal
    });
    let body = {};
    try { body = await response.json(); }
    catch { body = {}; }
    return {
      status: response.status,
      success: body.success === true,
      duplicate: body.duplicate === true,
      processed: body.processed === true,
      eventId: String(body.eventId || "")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readState(db) {
  const [intent, order, attempts, event] = await Promise.all([
    db.from("payment_intents")
      .select("id,business_order_id,provider,merchant_ref,expected_amount_minor,currency,status,provider_order_id,provider_payment_id,provider_status,requires_reconciliation,version,updated_at,paid_at")
      .eq("id", INTENT_ID).single(),
    db.from("orders")
      .select("id,hotel_slug,payment_status,gateway_status,gateway_order_id,gateway_payment_id,payment_verified_at,paid_at")
      .eq("id", Number(ORDER_ID)).single(),
    db.from("payment_attempts").select("id,evidence_source,accepted", { count: "exact" })
      .eq("payment_intent_id", INTENT_ID),
    db.from("payment_webhook_inbox")
      .select("id,provider_event_id,event_type,status,attempt_count,payment_intent_id,processed_at,lease_until", { count: "exact" })
      .eq("provider", "razorpay")
      .eq("merchant_ref", "LEGACY_PLATFORM_RAZORPAY")
      .eq("provider_event_id", EVENT_ID)
  ]);
  for (const [name, result] of [["intent", intent], ["order", order], ["attempts", attempts], ["event", event]]) {
    if (result.error) throw new Error(`${name} read failed: ${result.error.message}`);
  }
  return {
    intent: intent.data,
    order: order.data,
    attemptCount: attempts.count,
    attempts: attempts.data,
    eventCount: event.count,
    event: event.data[0] || null
  };
}

function validatePaidState(state) {
  const { intent, order } = state;
  assert(intent.status === "PAID" && intent.provider_status === "captured", "Intent is not captured/PAID");
  assert(intent.provider === "razorpay" && intent.merchant_ref === "LEGACY_PLATFORM_RAZORPAY", "Provider/merchant mismatch");
  assert(intent.expected_amount_minor === 12600 && intent.currency === "INR", "Amount/currency mismatch");
  assert(intent.requires_reconciliation === false, "Intent requires reconciliation");
  assert(intent.business_order_id === ORDER_ID, "Intent/order binding mismatch");
  assert(order.payment_status === "paid" && order.gateway_status === "paid", "Business order is not paid");
  assert(order.gateway_order_id === intent.provider_order_id, "Provider-order binding mismatch");
  assert(order.gateway_payment_id === intent.provider_payment_id, "Provider-payment binding mismatch");
}

async function waitForProcessed(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await readState(db);
    if (state.event?.status === "PROCESSED") return state;
    if (state.event?.status === "DEAD_LETTER") throw new Error("Ordering event entered DEAD_LETTER");
    await sleep(1000);
  }
  throw new Error("Timed out waiting for verify-then-webhook event processing");
}

async function main() {
  const keyId = required("RAZORPAY_KEY_ID");
  assert(!keyId.startsWith("rzp_live_"), "LIVE Razorpay key detected; aborting");
  assert(keyId.startsWith("rzp_test_"), "A Razorpay TEST key is required");
  const webhookSecret = required("RAZORPAY_WEBHOOK_SECRET");
  const configuredBackend = String(process.env.APP_BACKEND_BASE_URL || EXPECTED_BACKEND).replace(/\/$/, "");
  assert(configuredBackend === EXPECTED_BACKEND, "Backend target does not match the approved Task 2B deployment");
  const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "servehotels-task2b-verify-then-webhook" } }
  });

  const before = await readState(db);
  validatePaidState(before);
  assert(before.eventCount === 0, "Verify-then-webhook event already exists; refusing to overwrite evidence");
  assert(before.attemptCount === 1 && before.attempts[0]?.evidence_source === "CHECKOUT_VERIFY" && before.attempts[0]?.accepted,
    "Baseline does not prove checkout verification finalized the payment first");

  const payload = {
    entity: "event",
    account_id: "TEST_TASK2B_PLATFORM",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: before.intent.provider_payment_id,
          entity: "payment",
          amount: before.intent.expected_amount_minor,
          currency: before.intent.currency,
          status: "captured",
          order_id: before.intent.provider_order_id,
          captured: true
        }
      }
    },
    created_at: Math.floor(new Date(before.intent.paid_at).getTime() / 1000),
    id: EVENT_ID
  };
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const delivery = await postWebhook(rawBody, signature);
  assert(delivery.status === 202 && delivery.success && !delivery.duplicate,
    `Verify-then-webhook delivery failed with HTTP ${delivery.status}`);
  assert(delivery.eventId === EVENT_ID, "Webhook returned the wrong event ID");

  const after = await waitForProcessed(db);
  validatePaidState(after);
  assert(after.eventCount === 1 && after.event.status === "PROCESSED", "Ordering event was not durably processed once");
  assert(after.event.attempt_count === 1 && after.event.payment_intent_id === INTENT_ID,
    "Ordering event processing/intent link mismatch");
  assert(after.attemptCount === before.attemptCount, "Webhook-after-verify created another financial attempt");
  assert(after.intent.version === before.intent.version && after.intent.updated_at === before.intent.updated_at,
    "Webhook-after-verify changed PaymentIntent version/timestamp");
  assert(after.intent.paid_at === before.intent.paid_at && after.order.paid_at === before.order.paid_at,
    "Webhook-after-verify changed paid timestamps");
  assert(after.order.payment_verified_at === before.order.payment_verified_at,
    "Webhook-after-verify changed verification timestamp");

  console.log(JSON.stringify({
    result: "PASS",
    sequence: "Checkout verification finalized first, signed webhook processed later",
    delivery,
    database: {
      inboxRowsForEvent: after.eventCount,
      inboxStatus: after.event.status,
      inboxAttemptCount: after.event.attempt_count,
      financialAttemptsBefore: before.attemptCount,
      financialAttemptsAfter: after.attemptCount,
      paymentIntentVersionBefore: before.intent.version,
      paymentIntentVersionAfter: after.intent.version,
      paymentIntentStatus: after.intent.status,
      businessOrderStatus: after.order.payment_status,
      paidTimestampsUnchanged: true
    },
    liveRazorpayUsed: false,
    newPaymentCreated: false,
    notificationEffectExpected: false
  }, null, 2));
}

main().catch((error) => {
  console.error(`TASK2B_VERIFY_THEN_WEBHOOK_FAIL: ${error.name === "AbortError" ? "request timeout" : error.message}`);
  process.exitCode = 1;
});
