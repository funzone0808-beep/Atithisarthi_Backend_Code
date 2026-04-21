require("dotenv").config({ path: ".env" });

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_CONFIG_PATH = path.join(PROJECT_ROOT, "frontend/js/app-config.js");
const SERVER_PATH = path.join(PROJECT_ROOT, "backend/server.js");
const PAYMENT_WEBHOOKS_ROUTE_PATH = path.join(PROJECT_ROOT, "backend/routes/payment-webhooks.js");

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function getBooleanEnv(name) {
  return String(getEnv(name, "false")).trim().toLowerCase() === "true";
}

function isHttpsUrl(value = "") {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalUrl(value = "") {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isPlaceholder(value = "") {
  const text = String(value || "").trim().toLowerCase();
  return (
    !text ||
    text.includes("replace") ||
    text.includes("change-me") ||
    text.includes("your_") ||
    text.includes("example")
  );
}

function maskValue(value = "") {
  const text = String(value || "").trim();
  if (!text) return "missing";
  if (text.length <= 8) return "present";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function addIssue(list, message) {
  list.push(message);
}

function addWarning(list, message) {
  list.push(message);
}

function getIndexOrInfinity(source, marker) {
  const index = source.indexOf(marker);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function checkRequiredProductionEnv(issues) {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET",
    "FRONTEND_URL",
    "ADMIN_URL"
  ];

  required.forEach((name) => {
    if (isPlaceholder(getEnv(name))) {
      addIssue(issues, `${name} is missing or still looks like a placeholder.`);
    }
  });

  if (!isHttpsUrl(getEnv("SUPABASE_URL"))) {
    addIssue(issues, "SUPABASE_URL must be a valid HTTPS URL.");
  }

  ["FRONTEND_URL", "ADMIN_URL"].forEach((name) => {
    const value = getEnv(name);

    if (!isHttpsUrl(value)) {
      addIssue(issues, `${name} must be HTTPS in production.`);
    }

    if (isLocalUrl(value)) {
      addIssue(issues, `${name} must not point to localhost in production.`);
    }
  });

  if (String(getEnv("JWT_SECRET")).trim().length < 32) {
    addIssue(issues, "JWT_SECRET should be at least 32 characters for production.");
  }
}

function checkPaymentEnv(issues, warnings) {
  if (!getBooleanEnv("PAYMENT_GATEWAY_ENABLED")) {
    if (getBooleanEnv("PAYMENT_ROUTE_TRANSFERS_ENABLED")) {
      addIssue(
        issues,
        "PAYMENT_ROUTE_TRANSFERS_ENABLED is true while PAYMENT_GATEWAY_ENABLED is false."
      );
    }

    addWarning(warnings, "PAYMENT_GATEWAY_ENABLED is false. Online checkout will stay disabled.");
    return;
  }

  const provider = String(getEnv("PAYMENT_GATEWAY_PROVIDER", "razorpay")).trim().toLowerCase();
  const keyId = getEnv("RAZORPAY_KEY_ID");
  const currency = String(getEnv("PAYMENT_GATEWAY_CURRENCY", "INR")).trim().toUpperCase();
  const routeTransfersEnabled = getBooleanEnv("PAYMENT_ROUTE_TRANSFERS_ENABLED");
  const routeTestHotelSlug = getEnv("PAYMENT_ROUTE_TEST_HOTEL_SLUG");

  if (provider !== "razorpay") {
    addIssue(issues, "PAYMENT_GATEWAY_PROVIDER must be razorpay for the current integration.");
  }

  if (currency !== "INR") {
    addIssue(issues, "PAYMENT_GATEWAY_CURRENCY must be INR for the current Razorpay integration.");
  }

  ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"].forEach((name) => {
    if (isPlaceholder(getEnv(name))) {
      addIssue(issues, `${name} is required when payment gateway is enabled.`);
    }
  });

  if (keyId.startsWith("rzp_test_")) {
    addIssue(issues, "RAZORPAY_KEY_ID is a test key. Use live keys before real production launch.");
  }

  if (!isHttpsUrl(getEnv("RAZORPAY_API_BASE_URL", "https://api.razorpay.com/v1"))) {
    addIssue(issues, "RAZORPAY_API_BASE_URL must be HTTPS.");
  }

  if (routeTransfersEnabled && isPlaceholder(routeTestHotelSlug)) {
    addWarning(
      warnings,
      "PAYMENT_ROUTE_TEST_HOTEL_SLUG is missing. You will not be able to run the hotel Route readiness check quickly before launch."
    );
  }
}

function checkNotificationEnv(issues, warnings) {
  if (!getBooleanEnv("NOTIFICATION_DELIVERY_ENABLED")) {
    addWarning(warnings, "NOTIFICATION_DELIVERY_ENABLED is false. Email notifications will be skipped.");
    return;
  }

  const channel = String(getEnv("NOTIFICATION_DELIVERY_CHANNEL", "internal")).trim().toLowerCase();

  if (channel !== "email") {
    addWarning(warnings, `Notification channel is '${channel}'. Email delivery will not run unless channel is email.`);
    return;
  }

  [
    "NOTIFICATION_EMAIL_FROM",
    "NOTIFICATION_EMAIL_TO",
    "NOTIFICATION_SMTP_HOST",
    "NOTIFICATION_SMTP_USER",
    "NOTIFICATION_SMTP_PASS"
  ].forEach((name) => {
    if (isPlaceholder(getEnv(name))) {
      addIssue(issues, `${name} is required when email notifications are enabled.`);
    }
  });
}

function checkFrontendConfig(warnings) {
  if (!fs.existsSync(FRONTEND_CONFIG_PATH)) {
    addWarning(warnings, "frontend/js/app-config.js was not found.");
    return;
  }

  const source = fs.readFileSync(FRONTEND_CONFIG_PATH, "utf8");

  if (source.includes('API_BASE_URL: "http://localhost:5000/api"')) {
    addWarning(
      warnings,
      "frontend/js/app-config.js still contains an explicit localhost API_BASE_URL assignment."
    );
  }

  if (source.includes('BACKEND_BASE_URL: "http://localhost:5000"')) {
    addWarning(
      warnings,
      "frontend/js/app-config.js still contains an explicit localhost BACKEND_BASE_URL assignment."
    );
  }
}

function checkServerDeploymentHints(warnings) {
  if (!fs.existsSync(SERVER_PATH)) return;

  const source = fs.readFileSync(SERVER_PATH, "utf8");

  if (!source.includes('app.set("trust proxy", 1)')) {
    addWarning(
      warnings,
      "If deployed behind a trusted proxy/load balancer, enable app.set(\"trust proxy\", 1) after confirming host requirements."
    );
  }
}

function checkWebhookMountSafety(issues, warnings) {
  if (!fs.existsSync(SERVER_PATH)) return;

  const source = fs.readFileSync(SERVER_PATH, "utf8");
  const webhookMountMarker = '"/api/payments/webhook"';
  const rawParserMarker = 'express.raw({ type: "application/json", limit: "1mb" })';
  const jsonParserMarker = 'app.use(express.json({ limit: "1mb" }));';
  const webhookRouteMarker = "paymentWebhooksRoute";

  const webhookMountIndex = getIndexOrInfinity(source, webhookMountMarker);
  const rawParserIndex = getIndexOrInfinity(source, rawParserMarker);
  const jsonParserIndex = getIndexOrInfinity(source, jsonParserMarker);
  const webhookRouteIndex = getIndexOrInfinity(source, webhookRouteMarker);

  if (!Number.isFinite(webhookMountIndex) || !Number.isFinite(webhookRouteIndex)) {
    addIssue(issues, "Payment webhook route mount was not found in backend/server.js.");
    return;
  }

  if (!Number.isFinite(rawParserIndex)) {
    addIssue(issues, "Payment webhook raw-body parser was not found in backend/server.js.");
  }

  if (
    Number.isFinite(rawParserIndex) &&
    Number.isFinite(jsonParserIndex) &&
    rawParserIndex > jsonParserIndex
  ) {
    addIssue(
      issues,
      "Payment webhook raw-body parser appears after express.json(). Razorpay signature verification can break in production."
    );
  }

  if (
    fs.existsSync(PAYMENT_WEBHOOKS_ROUTE_PATH) &&
    !fs
      .readFileSync(PAYMENT_WEBHOOKS_ROUTE_PATH, "utf8")
      .includes('res.set("x-webhook-event-id", eventId);')
  ) {
    addWarning(
      warnings,
      "payment-webhooks.js is missing x-webhook-event-id response tagging, which makes replay/debug tracing harder."
    );
  }
}

function run() {
  const issues = [];
  const warnings = [];
  const nodeEnv = getEnv("NODE_ENV", "development");

  console.log("Production config verification");
  console.log("------------------------------");
  console.log(`NODE_ENV: ${nodeEnv}`);
  console.log(`PORT: ${getEnv("PORT", "5000")}`);
  console.log(`FRONTEND_URL: ${getEnv("FRONTEND_URL", "missing")}`);
  console.log(`ADMIN_URL: ${getEnv("ADMIN_URL", "missing")}`);
  console.log(`SUPABASE_URL: ${getEnv("SUPABASE_URL", "missing")}`);
  console.log(`PAYMENT_GATEWAY_ENABLED: ${getEnv("PAYMENT_GATEWAY_ENABLED", "false")}`);
  console.log(`RAZORPAY_KEY_ID: ${maskValue(getEnv("RAZORPAY_KEY_ID"))}`);
  console.log("");

  if (nodeEnv !== "production") {
    addWarning(warnings, "NODE_ENV is not production. Run this check with production env values before launch.");
  }

  checkRequiredProductionEnv(issues);
  checkPaymentEnv(issues, warnings);
  checkNotificationEnv(issues, warnings);
  checkFrontendConfig(warnings);
  checkServerDeploymentHints(warnings);
  checkWebhookMountSafety(issues, warnings);

  if (warnings.length) {
    console.log("Warnings:");
    warnings.forEach((warning) => console.log(`- ${warning}`));
    console.log("");
  }

  if (issues.length) {
    console.log("Production blockers:");
    issues.forEach((issue) => console.log(`- ${issue}`));
    process.exit(1);
  }

  console.log("Production config baseline passed.");
}

run();
