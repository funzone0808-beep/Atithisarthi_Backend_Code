require("dotenv").config({ path: ".env" });

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { getPaymentGatewaySafetyIssue } = require("../utils/payment-gateway");

const REQUIRED_ORDER_COLUMNS = [
  "payment_status",
  "billing_status",
  "paid_at",
  "order_type",
  "table_number",
  "order_source",
  "payment_gateway",
  "gateway_order_id",
  "gateway_payment_id",
  "gateway_signature",
  "gateway_status",
  "payment_verified_at",
  "payment_amount",
  "payment_currency",
  "payment_error",
  "payment_metadata"
];
const REQUIRED_WEBHOOK_EVENT_COLUMNS = [
  "provider",
  "event_id",
  "event_type",
  "gateway_order_id",
  "gateway_payment_id",
  "local_order_id",
  "processing_status",
  "error_message",
  "received_at",
  "processed_at"
];
const ROUTE_ORDER_COLUMNS = [
  "gateway_transfer_id",
  "gateway_transfer_status",
  "gateway_settlement_status",
  "gateway_transfer_error"
];
const ROUTE_SETTINGS_COLUMNS = [
  "hotel_slug",
  "provider",
  "route_enabled",
  "razorpay_linked_account_id"
];

const FRONTEND_CONFIG_PATH = path.resolve(
  __dirname,
  "../../frontend/js/app-config.js"
);

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function getBooleanEnv(name) {
  return String(getEnv(name, "false")).trim().toLowerCase() === "true";
}

function maskKey(value = "") {
  const text = String(value || "").trim();
  if (!text) return "missing";
  if (text.length <= 8) return "present";
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function readFrontendGatewayFlags() {
  if (!fs.existsSync(FRONTEND_CONFIG_PATH)) {
    return {
      exists: false,
      configMode: "missing",
      enabled: false,
      checkoutEnabled: false,
      provider: "",
      scriptUrl: "",
      needsRuntimeBrowserCheck: false
    };
  }

  const source = fs.readFileSync(FRONTEND_CONFIG_PATH, "utf8");
  const usesRuntimeConfig =
    source.includes("window.APP_RUNTIME_CONFIG") ||
    source.includes("existingConfig.PAYMENT_GATEWAY_ENABLED") ||
    source.includes("existingConfig.PAYMENT_GATEWAY_CHECKOUT_ENABLED");
  const getBooleanFlag = (name) => {
    const staticMatch = source.match(
      new RegExp(`${name}\\s*:\\s*(true|false)`, "i")
    );

    if (staticMatch) {
      return staticMatch[1].toLowerCase() === "true";
    }

    const runtimeFallbackMatch = source.match(
      new RegExp(
        `${name}\\s*:\\s*[\\s\\S]{0,220}?:\\s*(true|false)`,
        "i"
      )
    );

    return runtimeFallbackMatch
      ? runtimeFallbackMatch[1].toLowerCase() === "true"
      : false;
  };
  const getStringFlag = (name, fallbackPattern = null, fallbackValue = "") => {
    const directMatch = source.match(
      new RegExp(`${name}\\s*:\\s*["']([^"']+)["']`, "i")
    );
    if (directMatch) return directMatch[1];

    const runtimeFallbackMatch = source.match(
      new RegExp(`${name}\\s*:\\s*[\\s\\S]{0,220}?\\|\\|\\s*["']([^"']+)["']`, "i")
    );
    if (runtimeFallbackMatch) return runtimeFallbackMatch[1];

    if (
      fallbackPattern &&
      new RegExp(`${name}`, "i").test(source) &&
      fallbackPattern.test(source)
    ) {
      return fallbackValue;
    }

    return "";
  };

  return {
    exists: true,
    configMode: usesRuntimeConfig ? "runtime-config-driven" : "static-source",
    enabled: getBooleanFlag("PAYMENT_GATEWAY_ENABLED"),
    checkoutEnabled: getBooleanFlag("PAYMENT_GATEWAY_CHECKOUT_ENABLED"),
    provider: getStringFlag("PAYMENT_GATEWAY_PROVIDER", /razorpay/i, "razorpay"),
    scriptUrl: getStringFlag(
      "PAYMENT_GATEWAY_SCRIPT_URL",
      /https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js/i,
      "https://checkout.razorpay.com/v1/checkout.js"
    ),
    needsRuntimeBrowserCheck: usesRuntimeConfig
  };
}

async function checkOrderColumns() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return {
      ok: false,
      message: "missing Supabase environment values"
    };
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("orders")
    .select(["id", ...REQUIRED_ORDER_COLUMNS].join(","))
    .limit(1);

  if (error) {
    return {
      ok: false,
      message: `${error.code || "UNKNOWN"} ${error.message || ""}`.trim()
    };
  }

  return {
    ok: true,
    message: "required order columns are available"
  };
}

async function checkWebhookEventsTable() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return {
      ok: false,
      message: "missing Supabase environment values"
    };
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("payment_webhook_events")
    .select(["id", ...REQUIRED_WEBHOOK_EVENT_COLUMNS].join(","))
    .limit(1);

  if (error) {
    return {
      ok: false,
      message: `${error.code || "UNKNOWN"} ${error.message || ""}`.trim()
    };
  }

  return {
    ok: true,
    message: "payment webhook event table is available"
  };
}

async function checkRouteOrderColumns() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return {
      ok: false,
      message: "missing Supabase environment values"
    };
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("orders")
    .select(["id", ...ROUTE_ORDER_COLUMNS].join(","))
    .limit(1);

  if (error) {
    return {
      ok: false,
      message: `${error.code || "UNKNOWN"} ${error.message || ""}`.trim()
    };
  }

  return {
    ok: true,
    message: "Route transfer order columns are available"
  };
}

async function checkRouteSettingsTable() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return {
      ok: false,
      message: "missing Supabase environment values"
    };
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("hotel_payment_route_settings")
    .select(ROUTE_SETTINGS_COLUMNS.join(","))
    .limit(1);

  if (error) {
    return {
      ok: false,
      message: `${error.code || "UNKNOWN"} ${error.message || ""}`.trim()
    };
  }

  return {
    ok: true,
    message: "hotel Route settings table is available"
  };
}

async function main() {
  const provider = String(getEnv("PAYMENT_GATEWAY_PROVIDER", "razorpay")).trim().toLowerCase();
  const backendEnabled = getBooleanEnv("PAYMENT_GATEWAY_ENABLED");
  const keyId = getEnv("RAZORPAY_KEY_ID");
  const keySecret = getEnv("RAZORPAY_KEY_SECRET");
  const webhookSecret = getEnv("RAZORPAY_WEBHOOK_SECRET");
  const currency = getEnv("PAYMENT_GATEWAY_CURRENCY", "INR");
  const apiBaseUrl = getEnv("RAZORPAY_API_BASE_URL", "https://api.razorpay.com/v1");
  const routeTransfersEnabled = getBooleanEnv("PAYMENT_ROUTE_TRANSFERS_ENABLED");
  const frontendFlags = readFrontendGatewayFlags();
  const schemaCheck = await checkOrderColumns();
  const webhookSchemaCheck = await checkWebhookEventsTable();
  const routeOrderSchemaCheck = await checkRouteOrderColumns();
  const routeSettingsSchemaCheck = await checkRouteSettingsTable();
  const gatewaySafetyIssue = getPaymentGatewaySafetyIssue();
  const issues = [];

  console.log("Payment gateway readiness check");
  console.log("--------------------------------");
  console.log(`Backend enabled: ${backendEnabled ? "yes" : "no"}`);
  console.log(`Provider: ${provider}`);
  console.log(`Currency: ${currency}`);
  console.log(`Razorpay key id: ${maskKey(keyId)}`);
  console.log(`Razorpay key secret: ${keySecret ? "present" : "missing"}`);
  console.log(`Razorpay webhook secret: ${webhookSecret ? "present" : "missing"}`);
  console.log(`Razorpay API base URL: ${apiBaseUrl}`);
  console.log(`Route transfers enabled: ${routeTransfersEnabled ? "yes" : "no"}`);
  console.log(`Backend key safety: ${gatewaySafetyIssue || "ok"}`);
  console.log(`Order schema: ${schemaCheck.ok ? "ready" : "not ready"} (${schemaCheck.message})`);
  console.log(`Webhook schema: ${webhookSchemaCheck.ok ? "ready" : "not ready"} (${webhookSchemaCheck.message})`);
  console.log(`Route order schema: ${routeOrderSchemaCheck.ok ? "ready" : "not ready"} (${routeOrderSchemaCheck.message})`);
  console.log(`Route settings schema: ${routeSettingsSchemaCheck.ok ? "ready" : "not ready"} (${routeSettingsSchemaCheck.message})`);
  console.log(
    `Frontend config: ${frontendFlags.exists ? "found" : "missing"}`
  );
  console.log(`Frontend config mode: ${frontendFlags.configMode}`);
  console.log(
    `Frontend gateway flags: enabled=${frontendFlags.enabled}, checkout=${frontendFlags.checkoutEnabled}, provider=${frontendFlags.provider || "missing"}`
  );
  console.log(`Frontend script URL: ${frontendFlags.scriptUrl || "missing"}`);
  if (frontendFlags.needsRuntimeBrowserCheck) {
    console.log("Frontend runtime note: deployed payment flags must be confirmed in-browser because this frontend uses runtime config hooks.");
  }
  console.log("");
  console.log("No live payment was attempted by this check.");

  if (provider !== "razorpay") {
    issues.push("PAYMENT_GATEWAY_PROVIDER must be razorpay for the current integration.");
  }

  if (!schemaCheck.ok) {
    issues.push(
      "Apply add-order-table-context-columns.sql, add-order-billing-metadata-columns.sql, and add-order-payment-gateway-columns.sql."
    );
  }

  if (!webhookSchemaCheck.ok) {
    issues.push("Apply create-payment-webhook-events-table.sql for production webhook idempotency.");
  }

  if (routeTransfersEnabled && !routeOrderSchemaCheck.ok) {
    issues.push("Apply add-order-route-transfer-columns.sql before enabling Route transfers.");
  }

  if (routeTransfersEnabled && !routeSettingsSchemaCheck.ok) {
    issues.push("Apply create-hotel-payment-route-settings-table.sql before enabling Route transfers.");
  }

  if (backendEnabled && (!keyId || !keySecret)) {
    issues.push("Backend gateway is enabled but Razorpay test keys are missing.");
  }

  if (backendEnabled && !webhookSecret) {
    issues.push("Backend gateway is enabled but RAZORPAY_WEBHOOK_SECRET is missing.");
  }

  if (gatewaySafetyIssue) {
    issues.push(gatewaySafetyIssue);
  }

  if (
    frontendFlags.configMode === "static-source" &&
    frontendFlags.checkoutEnabled &&
    !backendEnabled
  ) {
    issues.push("Frontend checkout is enabled but backend PAYMENT_GATEWAY_ENABLED is false.");
  }

  if (
    frontendFlags.configMode === "static-source" &&
    frontendFlags.enabled &&
    frontendFlags.provider !== "razorpay"
  ) {
    issues.push("Frontend PAYMENT_GATEWAY_PROVIDER must be razorpay for the current integration.");
  }

  if (
    frontendFlags.configMode === "static-source" &&
    frontendFlags.enabled &&
    !frontendFlags.scriptUrl
  ) {
    issues.push("Frontend PAYMENT_GATEWAY_SCRIPT_URL is missing.");
  }

  if (issues.length) {
    console.log("");
    console.log("Readiness issues:");
    issues.forEach((issue) => console.log(`- ${issue}`));
    process.exit(1);
  }

  const frontendAppearsCheckoutReady =
    frontendFlags.configMode === "runtime-config-driven"
      ? Boolean(frontendFlags.provider === "razorpay" && frontendFlags.scriptUrl)
      : Boolean(
          frontendFlags.enabled &&
            frontendFlags.checkoutEnabled &&
            frontendFlags.provider === "razorpay"
        );

  const readyForEndToEndTest =
    backendEnabled &&
    Boolean(keyId && keySecret) &&
    Boolean(webhookSecret) &&
    keyId.startsWith("rzp_test_") &&
    frontendAppearsCheckoutReady &&
    schemaCheck.ok &&
    webhookSchemaCheck.ok;

  console.log("");
  if (readyForEndToEndTest) {
    console.log("Payment gateway is ready for one local end-to-end test payment.");
  } else {
    console.log("Payment gateway baseline is safe, but test checkout is not active yet.");
    console.log("Add Razorpay test keys and enable the backend/frontend test flags when you are ready.");
  }
}

main().catch((error) => {
  console.error(`Payment gateway readiness check failed: ${error.message}`);
  process.exit(1);
});
