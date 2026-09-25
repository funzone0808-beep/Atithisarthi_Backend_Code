"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const backendRoot = path.resolve(__dirname, "..");
const results = [];

function add(status, item, detail) {
  results.push({ status, item, detail });
  console.log(`[${status}] ${item}: ${detail}`);
}

function value(name) {
  return String(process.env[name] || "").trim();
}

function isPlaceholder(input) {
  return !input || /replace|your[-_ ]|example|changeme|placeholder/i.test(input);
}

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function projectRefFromUrl(input) {
  try {
    const hostname = new URL(input).hostname;
    return hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : "non-standard-host";
  } catch {
    return "invalid-url";
  }
}

async function verifyTable(client, table, columns) {
  const { error } = await client.from(table).select(columns).limit(0);
  if (error) {
    add("FAIL", `Task 2A table ${table}`, `Catalog/API check failed (${error.code || "unknown code"}).`);
    return;
  }
  add("PASS", `Task 2A table ${table}`, "Reachable with expected columns.");
}

async function loadPostgrestOpenApi(supabaseUrl, serviceKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`, {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/openapi+json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function verifySourceConfiguration() {
  const server = read("server.js");
  const payments = read("routes/payments.js");
  const webhooks = read("routes/payment-webhooks.js");
  const gateway = read("utils/payment-gateway.js");

  const rawRouteIndex = server.indexOf("\"/api/payments/webhook\"");
  const jsonParserIndex = server.indexOf("express.json(");
  const hasRawBody = rawRouteIndex >= 0 && /express\.raw\(\{\s*type:\s*"application\/json"/s.test(server);
  if (hasRawBody && jsonParserIndex >= 0 && rawRouteIndex < jsonParserIndex) {
    add("PASS", "Raw webhook body handling", "Webhook route uses express.raw before the global JSON parser.");
  } else {
    add("FAIL", "Raw webhook body handling", "Webhook raw-body route is missing or ordered after JSON parsing.");
  }

  const requiredRoutes = ["/readiness", "/init", "/verify", "/reconcile", "/fail"];
  const missingRoutes = requiredRoutes.filter((route) => !payments.includes(`"${route}"`));
  if (missingRoutes.length === 0) {
    add("PASS", "Payment route configuration", "Readiness, init, verify, reconcile, and fail routes are present.");
  } else {
    add("FAIL", "Payment route configuration", `Missing route declarations: ${missingRoutes.join(", ")}.`);
  }

  const webhookSignals = ["verifyWebhook", "inbox.enqueue", "processPaymentWebhookInboxOnce"];
  const missingWebhookSignals = webhookSignals.filter((signal) => !webhooks.includes(signal));
  if (missingWebhookSignals.length === 0) {
    add("PASS", "Webhook integration configuration", "Signature verification, durable enqueue, and worker trigger are wired.");
  } else {
    add("FAIL", "Webhook integration configuration", `Missing integration markers: ${missingWebhookSignals.join(", ")}.`);
  }

  const adapterOperations = ["createPaymentOrder", "getPaymentStatus", "verifyCheckoutEvidence", "verifyWebhook", "getOrderPayments"];
  const missingAdapterOperations = adapterOperations.filter((operation) => !gateway.includes(operation));
  if (missingAdapterOperations.length === 0) {
    add("PASS", "Razorpay adapter boundary", "Required payment adapter operations are present.");
  } else {
    add("FAIL", "Razorpay adapter boundary", `Missing adapter operations: ${missingAdapterOperations.join(", ")}.`);
  }
}

async function main() {
  console.log("Task 2B Razorpay TEST preflight (read-only; secret values suppressed)");

  const razorpayKeyId = value("RAZORPAY_KEY_ID");
  if (razorpayKeyId.startsWith("rzp_live_")) {
    add("FAIL", "Razorpay credential mode", "LIVE key detected. Preflight aborted before database or provider access.");
    console.log("OVERALL: FAIL");
    process.exitCode = 2;
    return;
  }
  if (razorpayKeyId.startsWith("rzp_test_") && !isPlaceholder(razorpayKeyId)) {
    add("PASS", "Razorpay credential mode", "A non-placeholder TEST key ID is configured.");
  } else {
    add("USER ACTION REQUIRED", "Razorpay credential mode", "Configure a non-placeholder rzp_test_ key ID; LIVE keys are prohibited.");
  }

  if (!isPlaceholder(value("RAZORPAY_KEY_SECRET"))) {
    add("PASS", "Razorpay key secret", "Configured (value suppressed).");
  } else {
    add("USER ACTION REQUIRED", "Razorpay key secret", "Configure the TEST key secret.");
  }

  if (!isPlaceholder(value("RAZORPAY_WEBHOOK_SECRET"))) {
    add("PASS", "Razorpay webhook secret", "Configured (value suppressed).");
  } else {
    add("USER ACTION REQUIRED", "Razorpay webhook secret", "Configure a dedicated TEST webhook secret.");
  }

  const gatewayEnabled = value("PAYMENT_GATEWAY_ENABLED").toLowerCase() === "true";
  add(
    gatewayEnabled ? "PASS" : "USER ACTION REQUIRED",
    "Payment gateway enablement",
    gatewayEnabled ? "Enabled for TEST acceptance." : "Set PAYMENT_GATEWAY_ENABLED=true for the controlled TEST run."
  );

  const provider = (value("PAYMENT_GATEWAY_PROVIDER") || "razorpay").toLowerCase();
  add(provider === "razorpay" ? "PASS" : "FAIL", "Payment provider", provider === "razorpay" ? "Razorpay selected." : "Task 2B requires Razorpay.");

  const currency = (value("PAYMENT_GATEWAY_CURRENCY") || "INR").toUpperCase();
  add(currency === "INR" ? "PASS" : "FAIL", "Payment currency", currency === "INR" ? "INR selected." : "Task 2B acceptance is defined for INR.");

  const apiBase = value("RAZORPAY_API_BASE_URL") || "https://api.razorpay.com/v1";
  let apiBaseSafe = false;
  try {
    const parsed = new URL(apiBase);
    apiBaseSafe = parsed.protocol === "https:" && parsed.hostname === "api.razorpay.com" && parsed.pathname.replace(/\/$/, "") === "/v1";
  } catch {
    apiBaseSafe = false;
  }
  add(apiBaseSafe ? "PASS" : "FAIL", "Razorpay API base", apiBaseSafe ? "Official HTTPS API origin configured." : "Expected https://api.razorpay.com/v1.");

  const timeoutMs = Number(value("PAYMENT_GATEWAY_TIMEOUT_MS") || "10000");
  add(Number.isFinite(timeoutMs) && timeoutMs > 0 ? "PASS" : "FAIL", "Provider timeout", Number.isFinite(timeoutMs) && timeoutMs > 0 ? `Configured (${timeoutMs} ms).` : "Set a positive PAYMENT_GATEWAY_TIMEOUT_MS.");

  const routeTransfers = value("PAYMENT_ROUTE_TRANSFERS_ENABLED").toLowerCase() === "true";
  add(routeTransfers ? "USER ACTION REQUIRED" : "PASS", "Razorpay Route transfers", routeTransfers ? "Disable for the isolated Task 2B platform-account test." : "Disabled.");

  const workerEnabled = value("PAYMENT_WEBHOOK_WORKER_ENABLED").toLowerCase() === "true";
  add(workerEnabled ? "USER ACTION REQUIRED" : "PASS", "Webhook worker initial state", workerEnabled ? "Disable it for the first backend boot; enable only for the controlled worker phase." : "Disabled for initial server verification.");
  const workerInterval = Number(value("PAYMENT_WEBHOOK_WORKER_INTERVAL_MS") || "5000");
  add(Number.isFinite(workerInterval) && workerInterval >= 1000 ? "PASS" : "FAIL", "Webhook worker interval", Number.isFinite(workerInterval) && workerInterval >= 1000 ? `Configured (${workerInterval} ms).` : "Set an interval of at least 1000 ms.");

  const notificationsEnabled = value("NOTIFICATION_DELIVERY_ENABLED").toLowerCase() === "true";
  add(notificationsEnabled ? "USER ACTION REQUIRED" : "PASS", "Notification isolation", notificationsEnabled ? "Delivery is enabled; disable it before Task 2B payment execution." : "Delivery disabled.");

  const nodeEnv = (value("NODE_ENV") || "development").toLowerCase();
  add(nodeEnv === "production" ? "FAIL" : "PASS", "Runtime environment", nodeEnv === "production" ? "NODE_ENV=production is not accepted for this pre-production test." : `${nodeEnv} environment selected.`);

  const backendBase = value("APP_BACKEND_BASE_URL");
  if (!backendBase) {
    add("USER ACTION REQUIRED", "Public backend base URL", "Configure the deployed HTTPS backend URL before webhook setup.");
  } else {
    try {
      const parsed = new URL(backendBase);
      const externalHttps = parsed.protocol === "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname);
      add(externalHttps ? "PASS" : "USER ACTION REQUIRED", "Public backend base URL", externalHttps ? "External HTTPS URL configured." : "Local/non-HTTPS URL is suitable only for local checks; provide the deployed HTTPS URL for webhooks.");
    } catch {
      add("FAIL", "Public backend base URL", "Configured value is not a valid URL.");
    }
  }

  verifySourceConfiguration();

  const supabaseUrl = value("SUPABASE_URL");
  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseReady = !isPlaceholder(supabaseUrl) && !isPlaceholder(serviceKey);
  add(!isPlaceholder(supabaseUrl) ? "PASS" : "FAIL", "Supabase URL", !isPlaceholder(supabaseUrl) ? `Configured for project ${projectRefFromUrl(supabaseUrl)}.` : "Missing or placeholder URL.");
  add(!isPlaceholder(serviceKey) ? "PASS" : "FAIL", "Supabase service role key", !isPlaceholder(serviceKey) ? "Configured (value suppressed)." : "Missing or placeholder key.");

  const productionRef = value("PRODUCTION_SUPABASE_PROJECT_REF");
  const currentRef = projectRefFromUrl(supabaseUrl);
  if (productionRef && currentRef === productionRef) {
    add("FAIL", "Production credential crossover", "Configured Supabase project matches PRODUCTION_SUPABASE_PROJECT_REF.");
  } else if (razorpayKeyId.startsWith("rzp_test_") && nodeEnv !== "production") {
    add("PASS", "Production credential crossover", "No LIVE Razorpay key or production runtime mode detected; Supabase target is user-designated pre-production.");
  } else {
    add("USER ACTION REQUIRED", "Production credential crossover", "Confirm this Supabase project and deployed URLs are pre-production-only.");
  }

  if (supabaseReady) {
    const client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "servehotels-task2b-preflight" } },
    });
    await verifyTable(client, "payment_intents", "id,hotel_slug,operation,business_order_id,merchant_ref,credential_ref,provider,expected_amount_minor,currency,status,idempotency_key,request_digest,provider_order_id,provider_payment_id,requires_reconciliation,version");
    await verifyTable(client, "payment_attempts", "id,payment_intent_id,provider,merchant_ref,provider_order_id,provider_payment_id,provider_status,amount_minor,currency,evidence_source,evidence_digest,accepted,rejection_code");
    await verifyTable(client, "payment_webhook_inbox", "id,provider,merchant_ref,provider_event_id,payload_digest,event_type,status,attempt_count,lease_owner,lease_until,processed_at");

    try {
      const document = await loadPostgrestOpenApi(supabaseUrl, serviceKey);
      const paths = document.paths || {};
      for (const rpc of ["claim_payment_intent_provider_creation", "attach_payment_intent_provider_order", "finalize_captured_payment", "claim_payment_webhook", "complete_payment_webhook"]) {
        const available = Boolean(paths[`/rpc/${rpc}`]);
        add(available ? "PASS" : "FAIL", `Task 2A RPC ${rpc}`, available ? "Present in PostgREST schema cache." : "Not present in PostgREST schema cache.");
      }
    } catch (error) {
      add("FAIL", "Task 2A RPC catalog", `Unable to read PostgREST OpenAPI metadata (${error.name === "AbortError" ? "timeout" : error.message}).`);
    }
  }

  const failCount = results.filter((entry) => entry.status === "FAIL").length;
  const actionCount = results.filter((entry) => entry.status === "USER ACTION REQUIRED").length;
  const overall = failCount > 0 ? "FAIL" : actionCount > 0 ? "USER ACTION REQUIRED" : "PASS";
  console.log(`SUMMARY: ${results.length - failCount - actionCount} PASS, ${failCount} FAIL, ${actionCount} USER ACTION REQUIRED`);
  console.log(`OVERALL: ${overall}`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(`[FAIL] Preflight execution: ${error.name === "AbortError" ? "Timed out." : error.message}`);
  console.log("OVERALL: FAIL");
  process.exitCode = 1;
});
