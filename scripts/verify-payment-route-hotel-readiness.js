require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");
const { getPaymentGatewaySafetyIssue } = require("../utils/payment-gateway");

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

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function getBooleanEnv(name) {
  return String(getEnv(name, "false")).trim().toLowerCase() === "true";
}

function getTargetHotelSlug() {
  return String(
    process.argv[2] ||
      getEnv("PAYMENT_ROUTE_TEST_HOTEL_SLUG") ||
      getEnv("HOTEL_SLUG") ||
      ""
  ).trim();
}

function maskKey(value = "") {
  const text = String(value || "").trim();
  if (!text) return "missing";
  if (text.length <= 8) return "present";
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function maskLinkedAccount(value = "") {
  const text = String(value || "").trim();
  if (!text) return "missing";
  if (text.length <= 10) return text;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function getSupabaseClient() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(url, key);
}

async function checkHotelProfile(supabase, hotelSlug) {
  const { data, error } = await supabase
    .from("hotel_profiles")
    .select("hotel_slug,hotel_name")
    .eq("hotel_slug", hotelSlug)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: `${error.code || "UNKNOWN"} ${error.message || ""}`.trim(),
      hotel: null
    };
  }

  return {
    ok: !!data,
    message: data ? `found profile for ${data.hotel_name || hotelSlug}` : "hotel profile not found",
    hotel: data || null
  };
}

async function checkRouteSettings(supabase, hotelSlug) {
  const { data, error } = await supabase
    .from("hotel_payment_route_settings")
    .select(ROUTE_SETTINGS_COLUMNS.join(","))
    .eq("hotel_slug", hotelSlug)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: `${error.code || "UNKNOWN"} ${error.message || ""}`.trim(),
      settings: null
    };
  }

  return {
    ok: !!data,
    message: data ? "hotel Route settings found" : "hotel Route settings not found",
    settings: data || null
  };
}

async function checkRouteOrderColumns(supabase) {
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

function validateRouteSettings(settings = {}) {
  const issues = [];
  const provider = String(settings.provider || "").trim().toLowerCase();
  const linkedAccountId = String(settings.razorpay_linked_account_id || "").trim();

  if (provider !== "razorpay") {
    issues.push("Hotel Route provider must be razorpay.");
  }

  if (!settings.route_enabled) {
    issues.push("Hotel Route setting is saved but route_enabled is false.");
  }

  if (!/^acc_[A-Za-z0-9]+$/.test(linkedAccountId)) {
    issues.push("Hotel Razorpay linked account id must look like acc_xxxxx.");
  }

  return {
    ok: issues.length === 0,
    issues,
    linkedAccountId
  };
}

async function main() {
  const hotelSlug = getTargetHotelSlug();

  console.log("Hotel Razorpay Route readiness check");
  console.log("------------------------------------");

  if (!hotelSlug) {
    console.log("Hotel slug is required.");
    console.log("");
    console.log("Usage:");
    console.log("  npm.cmd run verify:payment-route-hotel -- hotel-sai-raj");
    console.log("or set PAYMENT_ROUTE_TEST_HOTEL_SLUG in backend/.env.");
    process.exit(1);
  }

  const provider = String(getEnv("PAYMENT_GATEWAY_PROVIDER", "razorpay")).trim().toLowerCase();
  const backendEnabled = getBooleanEnv("PAYMENT_GATEWAY_ENABLED");
  const routeTransfersEnabled = getBooleanEnv("PAYMENT_ROUTE_TRANSFERS_ENABLED");
  const currency = String(getEnv("PAYMENT_GATEWAY_CURRENCY", "INR")).trim().toUpperCase();
  const keyId = getEnv("RAZORPAY_KEY_ID");
  const keySecret = getEnv("RAZORPAY_KEY_SECRET");
  const webhookSecret = getEnv("RAZORPAY_WEBHOOK_SECRET");
  const gatewaySafetyIssue = getPaymentGatewaySafetyIssue();
  const supabase = getSupabaseClient();
  const hotelCheck = await checkHotelProfile(supabase, hotelSlug);
  const routeSettingsCheck = await checkRouteSettings(supabase, hotelSlug);
  const routeOrderColumnsCheck = await checkRouteOrderColumns(supabase);
  const routeValidation = routeSettingsCheck.settings
    ? validateRouteSettings(routeSettingsCheck.settings)
    : {
        ok: false,
        issues: ["Hotel Route settings row is missing."],
        linkedAccountId: ""
      };
  const issues = [];

  console.log(`Hotel slug: ${hotelSlug}`);
  console.log(`Backend gateway enabled: ${backendEnabled ? "yes" : "no"}`);
  console.log(`Route transfers enabled: ${routeTransfersEnabled ? "yes" : "no"}`);
  console.log(`Provider: ${provider}`);
  console.log(`Currency: ${currency}`);
  console.log(`Razorpay key id: ${maskKey(keyId)}`);
  console.log(`Razorpay key secret: ${keySecret ? "present" : "missing"}`);
  console.log(`Razorpay webhook secret: ${webhookSecret ? "present" : "missing"}`);
  console.log(`Backend key safety: ${gatewaySafetyIssue || "ok"}`);
  console.log(`Hotel profile: ${hotelCheck.ok ? "ready" : "not ready"} (${hotelCheck.message})`);
  console.log(`Route settings: ${routeSettingsCheck.ok ? "ready" : "not ready"} (${routeSettingsCheck.message})`);
  console.log(`Linked account id: ${maskLinkedAccount(routeValidation.linkedAccountId)}`);
  console.log(`Route order schema: ${routeOrderColumnsCheck.ok ? "ready" : "not ready"} (${routeOrderColumnsCheck.message})`);
  console.log("");
  console.log("No payment or transfer was attempted by this check.");

  if (!backendEnabled) {
    issues.push("PAYMENT_GATEWAY_ENABLED must be true for checkout testing.");
  }

  if (provider !== "razorpay") {
    issues.push("PAYMENT_GATEWAY_PROVIDER must be razorpay.");
  }

  if (currency !== "INR") {
    issues.push("PAYMENT_GATEWAY_CURRENCY must be INR for Razorpay Route transfers.");
  }

  if (!keyId || !keySecret) {
    issues.push("Razorpay key id and key secret are required.");
  }

  if (!webhookSecret) {
    issues.push("RAZORPAY_WEBHOOK_SECRET is required before Route testing.");
  }

  if (gatewaySafetyIssue) {
    issues.push(gatewaySafetyIssue);
  }

  if (!hotelCheck.ok) {
    issues.push("Create/save this hotel profile before Route testing.");
  }

  if (!routeSettingsCheck.ok) {
    issues.push("Save Payment Route Settings for this hotel in admin.");
  }

  if (!routeOrderColumnsCheck.ok) {
    issues.push("Apply add-order-route-transfer-columns.sql before Route testing.");
  }

  issues.push(...routeValidation.issues);

  if (issues.length) {
    console.log("");
    console.log("Route readiness issues:");
    issues.forEach((issue) => console.log(`- ${issue}`));
    process.exit(1);
  }

  console.log("");
  if (routeTransfersEnabled) {
    console.log("This hotel is ready for one controlled Razorpay Route test payment.");
  } else {
    console.log("This hotel is Route-configured, but global transfer creation is still disabled.");
    console.log("Set PAYMENT_ROUTE_TRANSFERS_ENABLED=true only when you are ready for one controlled test payment.");
  }
}

main().catch((error) => {
  console.error(`Hotel Route readiness check failed: ${error.message}`);
  process.exit(1);
});
