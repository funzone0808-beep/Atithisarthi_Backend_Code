"use strict";

const crypto = require("crypto");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const EXPECTED_BACKEND = "https://atithisarthibackendcode-production-0e4f.up.railway.app";
const INTENT_ID = "db4580a8-d549-4965-9b38-2d649dedc1fa";
const EVENT_ID = "TEST_TASK2B_DUPLICATE_pay_TgBLObyqKXIIcJ_v1";

function required(name) {
  const result = String(process.env[name] || "").trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
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
        "x-razorpay-signature": signature,
        "x-task2b-correlation-id": EVENT_ID
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
  const [intent, attempts, inbox, order] = await Promise.all([
    db.from("payment_intents")
      .select("id,business_order_id,status,provider,merchant_ref,expected_amount_minor,currency,provider_order_id,provider_payment_id,provider_status,requires_reconciliation,version,paid_at")
      .eq("id", INTENT_ID).single(),
    db.from("payment_attempts").select("id", { count: "exact" }).eq("payment_intent_id", INTENT_ID),
    db.from("payment_webhook_inbox")
      .select("id,provider_event_id,event_type,status,attempt_count,payment_intent_id,processed_at", { count: "exact" })
      .eq("provider", "razorpay")
      .eq("merchant_ref", "LEGACY_PLATFORM_RAZORPAY")
      .eq("provider_event_id", EVENT_ID),
    db.from("orders")
      .select("id,payment_status,gateway_status,gateway_order_id,gateway_payment_id,payment_amount,payment_currency,paid_at")
      .eq("id", 262).single()
  ]);
  for (const [name, result] of [["intent", intent], ["attempts", attempts], ["inbox", inbox], ["order", order]]) {
    if (result.error) throw new Error(`${name} read failed: ${result.error.message}`);
  }
  return {
    intent: intent.data,
    attemptCount: attempts.count,
    inboxCount: inbox.count,
    inbox: inbox.data[0] || null,
    order: order.data
  };
}

function validateBaseline(state) {
  const intent = state.intent;
  assert(intent.status === "PAID", "Target intent must already be PAID");
  assert(intent.provider === "razorpay", "Target intent provider mismatch");
  assert(intent.merchant_ref === "LEGACY_PLATFORM_RAZORPAY", "Target merchant mismatch");
  assert(intent.provider_order_id === "order_TgBLGwmfqaDgV9", "Target provider order mismatch");
  assert(intent.provider_payment_id === "pay_TgBLObyqKXIIcJ", "Target provider payment mismatch");
  assert(intent.provider_status === "captured", "Target payment is not captured");
  assert(intent.expected_amount_minor === 12600 && intent.currency === "INR", "Target amount/currency mismatch");
  assert(intent.requires_reconciliation === false, "Target intent requires reconciliation");
  assert(state.order.id === 262 && state.order.payment_status === "paid", "Target business order is not paid");
  assert(state.order.gateway_order_id === intent.provider_order_id, "Business/provider order binding mismatch");
  assert(state.order.gateway_payment_id === intent.provider_payment_id, "Business/provider payment binding mismatch");
}

async function waitUntilProcessed(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await readState(db);
    if (state.inbox?.status === "PROCESSED") return state;
    if (state.inbox?.status === "DEAD_LETTER") throw new Error("Synthetic duplicate event entered DEAD_LETTER");
    await sleep(1000);
  }
  throw new Error("Timed out waiting for the synthetic duplicate event to be processed");
}

async function main() {
  const keyId = required("RAZORPAY_KEY_ID");
  assert(!keyId.startsWith("rzp_live_"), "LIVE Razorpay key detected; aborting");
  assert(keyId.startsWith("rzp_test_"), "A Razorpay TEST key is required");
  const webhookSecret = required("RAZORPAY_WEBHOOK_SECRET");
  const supabaseUrl = required("SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const configuredBackend = String(process.env.APP_BACKEND_BASE_URL || EXPECTED_BACKEND).replace(/\/$/, "");
  assert(configuredBackend === EXPECTED_BACKEND, "Backend target does not match the approved Task 2B deployment");

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "servehotels-task2b-duplicate-runtime" } }
  });
  const before = await readState(db);
  validateBaseline(before);
  assert(before.attemptCount === 1, "Expected exactly one accepted financial attempt before replay");

  const createdAt = Math.floor(new Date(before.intent.paid_at).getTime() / 1000);
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
    created_at: createdAt,
    id: EVENT_ID
  };
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

  const first = await postWebhook(rawBody, signature);
  assert([200, 202].includes(first.status) && first.success, `First delivery failed with HTTP ${first.status}`);
  assert(first.eventId === EVENT_ID, "First delivery returned the wrong event id");
  const processed = await waitUntilProcessed(db);
  validateBaseline(processed);

  const second = await postWebhook(rawBody, signature);
  assert(second.status === 200 && second.success, `Duplicate delivery failed with HTTP ${second.status}`);
  assert(second.duplicate && second.processed, "Duplicate delivery was not acknowledged as already processed");
  assert(second.eventId === EVENT_ID, "Duplicate delivery returned the wrong event id");
  await sleep(1000);

  const after = await readState(db);
  validateBaseline(after);
  assert(after.inboxCount === 1, "Duplicate delivery created more than one inbox row");
  assert(after.inbox?.status === "PROCESSED", "Duplicate inbox row is not PROCESSED");
  assert(after.inbox?.attempt_count === 1, "Processed duplicate was claimed more than once");
  assert(after.inbox?.payment_intent_id === INTENT_ID, "Duplicate inbox row is linked to the wrong intent");
  assert(after.attemptCount === before.attemptCount, "Duplicate delivery created an additional financial attempt");
  assert(after.intent.version === before.intent.version, "Duplicate delivery changed the PaymentIntent version");
  assert(after.intent.status === before.intent.status, "Duplicate delivery changed the PaymentIntent state");
  assert(after.order.payment_status === before.order.payment_status, "Duplicate delivery changed the business-order payment state");
  assert(after.order.paid_at === before.order.paid_at, "Duplicate delivery changed the business-order paid timestamp");

  console.log(JSON.stringify({
    result: "PASS",
    mode: "Razorpay TEST signed synthetic redelivery against deployed webhook",
    eventId: EVENT_ID,
    firstDelivery: first,
    duplicateDelivery: second,
    database: {
      inboxRowsForEvent: after.inboxCount,
      inboxStatus: after.inbox.status,
      inboxAttemptCount: after.inbox.attempt_count,
      financialAttemptsBefore: before.attemptCount,
      financialAttemptsAfter: after.attemptCount,
      paymentIntentVersionBefore: before.intent.version,
      paymentIntentVersionAfter: after.intent.version,
      paymentIntentStatus: after.intent.status,
      businessOrderStatus: after.order.payment_status
    },
    liveRazorpayUsed: false,
    newPaymentCreated: false,
    notificationEffectExpected: false
  }, null, 2));
}

main().catch((error) => {
  console.error(`TASK2B_DUPLICATE_RUNTIME_FAIL: ${error.name === "AbortError" ? "request timeout" : error.message}`);
  process.exitCode = 1;
});
