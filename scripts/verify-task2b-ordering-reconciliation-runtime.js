"use strict";

const crypto = require("crypto");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const EXPECTED_BACKEND = "https://atithisarthibackendcode-production-0e4f.up.railway.app";
const EXPECTED_FRONTEND = "https://atithisarthi-frontend-code.narayanpatilharda08.workers.dev";
const INTENT_ID = "db4580a8-d549-4965-9b38-2d649dedc1fa";
const ORDER_ID = "262";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function post(pathname, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${EXPECTED_BACKEND}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: EXPECTED_FRONTEND },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let body = {};
    try { body = await response.json(); }
    catch { body = {}; }
    return {
      status: response.status,
      success: body.success === true,
      paymentIntentId: String(body.paymentIntentId || ""),
      captured: body.payment?.captured === true,
      reconciled: body.payment?.reconciled === true,
      providerStatus: String(body.payment?.status || ""),
      gatewayOrderId: String(body.payment?.gatewayOrderId || ""),
      gatewayPaymentId: String(body.payment?.gatewayPaymentId || ""),
      orderUpdated: body.orderUpdated === true,
      orderUpdateReason: String(body.orderUpdateReason || ""),
      code: String(body.code || "")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readState(db) {
  const [intent, order, attempts, inbox] = await Promise.all([
    db.from("payment_intents")
      .select("id,business_order_id,provider,merchant_ref,expected_amount_minor,currency,status,provider_order_id,provider_payment_id,provider_status,requires_reconciliation,version,updated_at,paid_at")
      .eq("id", INTENT_ID).single(),
    db.from("orders")
      .select("id,hotel_slug,status,payment_status,gateway_status,gateway_order_id,gateway_payment_id,payment_amount,payment_currency,payment_verified_at,paid_at")
      .eq("id", Number(ORDER_ID)).single(),
    db.from("payment_attempts").select("id", { count: "exact", head: true }).eq("payment_intent_id", INTENT_ID),
    db.from("payment_webhook_inbox").select("id", { count: "exact", head: true }).eq("payment_intent_id", INTENT_ID)
  ]);
  for (const [name, result] of [["intent", intent], ["order", order], ["attempts", attempts], ["inbox", inbox]]) {
    if (result.error) throw new Error(`${name} read failed: ${result.error.message}`);
  }
  return { intent: intent.data, order: order.data, attemptCount: attempts.count, inboxCount: inbox.count };
}

function validateState(state) {
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

async function main() {
  const keyId = required("RAZORPAY_KEY_ID");
  assert(!keyId.startsWith("rzp_live_"), "LIVE Razorpay key detected; aborting");
  assert(keyId.startsWith("rzp_test_"), "A Razorpay TEST key is required");
  const keySecret = required("RAZORPAY_KEY_SECRET");
  const configuredBackend = String(process.env.APP_BACKEND_BASE_URL || EXPECTED_BACKEND).replace(/\/$/, "");
  assert(configuredBackend === EXPECTED_BACKEND, "Backend target does not match the approved Task 2B deployment");

  const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "servehotels-task2b-ordering-reconciliation" } }
  });
  const before = await readState(db);
  validateState(before);
  const checkoutSignature = crypto.createHmac("sha256", keySecret)
    .update(`${before.intent.provider_order_id}|${before.intent.provider_payment_id}`)
    .digest("hex");

  const verify = await post("/api/payments/verify", {
    paymentIntentId: INTENT_ID,
    hotelSlug: before.order.hotel_slug,
    orderId: ORDER_ID,
    gatewayOrderId: before.intent.provider_order_id,
    gatewayPaymentId: before.intent.provider_payment_id,
    gatewaySignature: checkoutSignature
  });
  assert(verify.status === 200 && verify.success && verify.captured, `Webhook-first checkout verification failed with HTTP ${verify.status}`);
  assert(verify.paymentIntentId === INTENT_ID, "Verify returned a different PaymentIntent");
  assert(verify.gatewayOrderId === before.intent.provider_order_id, "Verify returned a different provider order");
  assert(verify.gatewayPaymentId === before.intent.provider_payment_id, "Verify returned a different provider payment");
  assert(!verify.orderUpdated && verify.orderUpdateReason === "already_paid_same_payment",
    "Webhook-first verification was not idempotent");

  const reconcile = await post("/api/payments/reconcile", {
    paymentIntentId: INTENT_ID,
    hotelSlug: before.order.hotel_slug,
    orderId: ORDER_ID,
    gatewayOrderId: before.intent.provider_order_id
  });
  assert(reconcile.status === 200 && reconcile.success && reconcile.captured && reconcile.reconciled,
    `Reconciliation failed with HTTP ${reconcile.status}`);
  assert(reconcile.paymentIntentId === INTENT_ID, "Reconcile returned a different PaymentIntent");
  assert(reconcile.gatewayOrderId === before.intent.provider_order_id, "Reconcile returned a different provider order");
  assert(reconcile.gatewayPaymentId === before.intent.provider_payment_id, "Reconcile returned a different provider payment");
  assert(!reconcile.orderUpdated && reconcile.orderUpdateReason === "already_paid_same_payment",
    "Reconciliation was not idempotent");

  const after = await readState(db);
  validateState(after);
  assert(after.intent.version === before.intent.version, "Idempotent verify/reconcile changed PaymentIntent version");
  assert(after.intent.updated_at === before.intent.updated_at, "Idempotent verify/reconcile changed PaymentIntent timestamp");
  assert(after.intent.paid_at === before.intent.paid_at, "Idempotent verify/reconcile changed intent paid timestamp");
  assert(after.order.paid_at === before.order.paid_at, "Idempotent verify/reconcile changed order paid timestamp");
  assert(after.order.payment_verified_at === before.order.payment_verified_at,
    "Idempotent verify/reconcile changed order verification timestamp");
  assert(after.attemptCount === before.attemptCount, "Idempotent verify/reconcile created another financial attempt");
  assert(after.inboxCount === before.inboxCount, "Idempotent verify/reconcile changed webhook evidence");

  console.log(JSON.stringify({
    result: "PASS",
    sequence: "Webhook finalized payment before checkout verification, followed by reconciliation",
    webhookThenVerify: verify,
    reconciliation: reconcile,
    database: {
      financialAttemptsBefore: before.attemptCount,
      financialAttemptsAfter: after.attemptCount,
      webhookRowsBefore: before.inboxCount,
      webhookRowsAfter: after.inboxCount,
      paymentIntentVersionBefore: before.intent.version,
      paymentIntentVersionAfter: after.intent.version,
      paymentIntentStatus: after.intent.status,
      businessOrderStatus: after.order.payment_status,
      paidTimestampsUnchanged: after.intent.paid_at === before.intent.paid_at && after.order.paid_at === before.order.paid_at
    },
    liveRazorpayUsed: false,
    newPaymentCreated: false,
    notificationEffectExpected: false
  }, null, 2));
}

main().catch((error) => {
  console.error(`TASK2B_ORDERING_RECONCILIATION_FAIL: ${error.name === "AbortError" ? "request timeout" : error.message}`);
  process.exitCode = 1;
});
