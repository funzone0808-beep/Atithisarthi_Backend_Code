"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const EXPECTED_BACKEND = "https://atithisarthibackendcode-production-0e4f.up.railway.app";
const EXPECTED_FRONTEND = "https://atithisarthi-frontend-code.narayanpatilharda08.workers.dev";
const HOTEL_SLUG = "hotel-sai-raj";
const IDEMPOTENCY_KEY = "TEST_TASK2B_IDEMPOTENCY_20260925_V1";
const ITEM_ID = "drink_1";

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

async function postInit(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${EXPECTED_BACKEND}/api/payments/init`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": IDEMPOTENCY_KEY,
        Origin: EXPECTED_FRONTEND
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let body = {};
    try { body = await response.json(); }
    catch { body = {}; }
    return {
      status: response.status,
      success: body.success === true,
      idempotent: body.idempotent === true,
      paymentIntentId: String(body.paymentIntentId || ""),
      gatewayOrderId: String(body.payment?.gatewayOrderId || body.gatewayOrderId || ""),
      orderId: body.order?.id === undefined || body.order?.id === null ? "" : String(body.order.id),
      code: String(body.code || "")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function findIntent(db) {
  const result = await db.from("payment_intents")
    .select("id,hotel_slug,operation,business_order_id,provider,merchant_ref,expected_amount_minor,currency,status,idempotency_key,provider_order_id,provider_payment_id,provider_status,requires_reconciliation,version,created_at,updated_at")
    .eq("hotel_slug", HOTEL_SLUG)
    .eq("operation", "FOOD_ORDER_PAYMENT")
    .eq("idempotency_key", IDEMPOTENCY_KEY)
    .maybeSingle();
  if (result.error) throw new Error(`PaymentIntent read failed: ${result.error.message}`);
  return result.data || null;
}

async function waitForLinkedIntent(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const intent = await findIntent(db);
    if (intent?.provider_order_id && intent?.business_order_id) return intent;
    await sleep(1000);
  }
  throw new Error("Timed out waiting for one provider order and business order to be linked");
}

async function readCounts(db, intent) {
  const queries = [
    db.from("payment_intents").select("id", { count: "exact", head: true })
      .eq("hotel_slug", HOTEL_SLUG)
      .eq("operation", "FOOD_ORDER_PAYMENT")
      .eq("idempotency_key", IDEMPOTENCY_KEY)
  ];
  if (intent) {
    queries.push(
      db.from("orders").select("id", { count: "exact", head: true })
        .eq("hotel_slug", HOTEL_SLUG).eq("gateway_order_id", intent.provider_order_id),
      db.from("payment_attempts").select("id", { count: "exact", head: true })
        .eq("payment_intent_id", intent.id),
      db.from("payment_webhook_inbox").select("id", { count: "exact", head: true })
        .eq("payment_intent_id", intent.id)
    );
  }
  const results = await Promise.all(queries);
  for (const result of results) {
    if (result.error) throw new Error(`Count query failed: ${result.error.message}`);
  }
  return {
    intents: results[0].count,
    orders: results[1]?.count ?? 0,
    attempts: results[2]?.count ?? 0,
    inbox: results[3]?.count ?? 0
  };
}

async function readOrder(db, id) {
  const result = await db.from("orders")
    .select("id,hotel_slug,status,payment_status,gateway_status,gateway_order_id,gateway_payment_id,payment_amount,payment_currency,paid_at")
    .eq("id", id).single();
  if (result.error) throw new Error(`Business-order read failed: ${result.error.message}`);
  return result.data;
}

function syntheticPayload() {
  return {
    hotelSlug: HOTEL_SLUG,
    paymentMethod: "Online Payment",
    items: [{ id: ITEM_ID, qty: 1 }],
    orderContext: { orderType: "standard", tableNumber: "", orderSource: "website" },
    orderDraft: {
      hotelName: "Hotel Sai Raj",
      customerName: "TEST_TASK2B_IDEMPOTENCY",
      customerPhone: "9999999999",
      customerAddress: "TEST_TASK2B_PREPRODUCTION_ONLY",
      note: "TEST_TASK2B_IDEMPOTENCY",
      whatsappMessage: ""
    }
  };
}

async function main() {
  assert(String(process.env.TASK2B_ALLOW_SYNTHETIC_PROVIDER_ORDER || "").toLowerCase() === "true",
    "Explicit TASK2B_ALLOW_SYNTHETIC_PROVIDER_ORDER=true confirmation is required");
  const keyId = required("RAZORPAY_KEY_ID");
  assert(!keyId.startsWith("rzp_live_"), "LIVE Razorpay key detected; aborting");
  assert(keyId.startsWith("rzp_test_"), "A Razorpay TEST key is required");
  const configuredBackend = String(process.env.APP_BACKEND_BASE_URL || EXPECTED_BACKEND).replace(/\/$/, "");
  assert(configuredBackend === EXPECTED_BACKEND, "Backend target does not match the approved Task 2B deployment");

  const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "servehotels-task2b-idempotency-runtime" } }
  });
  const menu = await db.from("menu_items").select("item_id")
    .eq("hotel_slug", HOTEL_SLUG).eq("item_id", ITEM_ID)
    .eq("is_available", true).eq("is_archived", false).maybeSingle();
  if (menu.error) throw new Error(`Synthetic menu fixture check failed: ${menu.error.message}`);
  assert(menu.data?.item_id === ITEM_ID, "Synthetic menu fixture is unavailable");

  const beforeIntent = await findIntent(db);
  const beforeCounts = await readCounts(db, beforeIntent);
  assert(beforeCounts.intents <= 1, "Synthetic idempotency key already has duplicate intents");
  const payload = syntheticPayload();

  const [first, second] = await Promise.all([postInit(payload), postInit(payload)]);
  for (const result of [first, second]) {
    assert([200, 201, 202].includes(result.status) && result.success,
      `Concurrent same-key request failed with HTTP ${result.status}`);
    assert(result.paymentIntentId, "Concurrent response omitted PaymentIntent ID");
  }
  assert(first.paymentIntentId === second.paymentIntentId, "Concurrent requests returned different PaymentIntents");

  const linkedIntent = await waitForLinkedIntent(db);
  assert(linkedIntent.id === first.paymentIntentId, "Database intent does not match concurrent responses");
  assert(linkedIntent.provider === "razorpay" && linkedIntent.merchant_ref === "LEGACY_PLATFORM_RAZORPAY",
    "Provider/merchant binding mismatch");
  assert(linkedIntent.currency === "INR" && linkedIntent.expected_amount_minor > 0,
    "Amount/currency binding is invalid");
  assert(!linkedIntent.provider_payment_id, "Synthetic initiation unexpectedly created a payment");
  assert(linkedIntent.status === "PENDING" && linkedIntent.requires_reconciliation === false,
    "Synthetic initiation is not safely pending");

  const stableReuse = await postInit(payload);
  assert(stableReuse.status === 200 && stableReuse.success && stableReuse.idempotent,
    `Stable same-key reuse failed with HTTP ${stableReuse.status}`);
  assert(stableReuse.paymentIntentId === linkedIntent.id, "Stable reuse returned a different PaymentIntent");
  assert(stableReuse.gatewayOrderId === linkedIntent.provider_order_id, "Stable reuse returned a different provider order");
  assert(stableReuse.orderId === String(linkedIntent.business_order_id), "Stable reuse returned a different business order");

  const conflictPayload = {
    ...payload,
    orderDraft: { ...payload.orderDraft, note: "TEST_TASK2B_IDEMPOTENCY_CHANGED_DIGEST" }
  };
  const conflict = await postInit(conflictPayload);
  assert(conflict.status === 409 && !conflict.success,
    `Same-key changed-digest request should return HTTP 409, got ${conflict.status}`);

  const afterIntent = await findIntent(db);
  const afterCounts = await readCounts(db, afterIntent);
  const order = await readOrder(db, afterIntent.business_order_id);
  assert(afterCounts.intents === 1, "Concurrent requests created multiple PaymentIntents");
  assert(afterCounts.orders === 1, "Concurrent requests created multiple linked provider orders");
  assert(afterCounts.attempts === 0, "Payment attempt exists even though no payment was made");
  assert(afterCounts.inbox === 0, "Webhook exists even though no payment was made");
  assert(afterIntent.provider_order_id === linkedIntent.provider_order_id, "Provider order changed during replay/conflict test");
  assert(afterIntent.version === linkedIntent.version, "PaymentIntent version changed during reuse/conflict test");
  assert(order.gateway_order_id === afterIntent.provider_order_id, "Business/provider order binding mismatch");
  assert(!order.gateway_payment_id && !order.paid_at && order.payment_status !== "paid",
    "Synthetic pending order was incorrectly marked paid");

  console.log(JSON.stringify({
    result: "PASS",
    mode: "Synthetic Razorpay TEST initiation; no checkout or capture",
    concurrentResponses: [first, second],
    stableReuse,
    changedDigestConflict: { status: conflict.status, success: conflict.success, code: conflict.code },
    database: {
      logicalIntentsBefore: beforeCounts.intents,
      logicalIntentsAfter: afterCounts.intents,
      linkedOrdersAfter: afterCounts.orders,
      paymentAttemptsAfter: afterCounts.attempts,
      webhookRowsAfter: afterCounts.inbox,
      intentStatus: afterIntent.status,
      providerPaymentIdPresent: !!afterIntent.provider_payment_id,
      businessOrderPaid: order.payment_status === "paid"
    },
    syntheticCustomerDataOnly: true,
    liveRazorpayUsed: false,
    checkoutOpened: false,
    paymentCreated: false,
    notificationSent: false
  }, null, 2));
}

main().catch((error) => {
  console.error(`TASK2B_IDEMPOTENCY_RUNTIME_FAIL: ${error.name === "AbortError" ? "request timeout" : error.message}`);
  process.exitCode = 1;
});
