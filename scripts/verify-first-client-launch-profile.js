require("dotenv").config({ path: ".env" });

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function getBooleanEnv(name, fallback = false) {
  const value = String(getEnv(name, fallback ? "true" : "false")).trim().toLowerCase();
  return value === "true";
}

function addIssue(list, message) {
  list.push(message);
}

function addWarning(list, message) {
  list.push(message);
}

function maskValue(value = "") {
  const text = String(value || "").trim();
  if (!text) return "missing";
  if (text.length <= 8) return "present";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function isLiveRazorpayKey(value = "") {
  return String(value || "").trim().toLowerCase().startsWith("rzp_live_");
}

function main() {
  const issues = [];
  const warnings = [];

  const paymentGatewayEnabled = getBooleanEnv("PAYMENT_GATEWAY_ENABLED", false);
  const fallbackOnSaveFailure = String(
    getEnv("APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE", "")
  ).trim().toLowerCase();
  const openWhatsAppAfterVerifiedOnlinePayment = String(
    getEnv("APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT", "")
  ).trim().toLowerCase();
  const razorpayKeyId = getEnv("RAZORPAY_KEY_ID", "");
  const webhookSecret = String(getEnv("RAZORPAY_WEBHOOK_SECRET", "")).trim();
  const nodeEnv = String(getEnv("NODE_ENV", "")).trim().toLowerCase();

  console.log("First-client launch profile check");
  console.log("--------------------------------");
  console.log(`NODE_ENV: ${getEnv("NODE_ENV", "missing")}`);
  console.log(`PAYMENT_GATEWAY_ENABLED: ${paymentGatewayEnabled ? "true" : "false"}`);
  console.log(
    `APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE: ${fallbackOnSaveFailure || "missing"}`
  );
  console.log(
    `APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT: ${openWhatsAppAfterVerifiedOnlinePayment || "missing"}`
  );
  console.log(`RAZORPAY_KEY_ID: ${maskValue(razorpayKeyId)}`);
  console.log(`RAZORPAY_WEBHOOK_SECRET: ${maskValue(webhookSecret)}`);

  if (nodeEnv !== "production") {
    addWarning(
      warnings,
      "NODE_ENV is not production. Run this check again with real production env values before client launch."
    );
  }

  if (fallbackOnSaveFailure !== "false") {
    addIssue(
      issues,
      "APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE should be false for first-client launch."
    );
  }

  if (!paymentGatewayEnabled) {
    addWarning(
      warnings,
      "PAYMENT_GATEWAY_ENABLED is false. This is the safer first-client launch posture unless live payment has already been fully verified."
    );
  } else {
    if (openWhatsAppAfterVerifiedOnlinePayment !== "true") {
      addIssue(
        issues,
        "APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT should be true when online payment is live for a WhatsApp-led first client."
      );
    }

    if (!isLiveRazorpayKey(razorpayKeyId)) {
      addIssue(
        issues,
        "RAZORPAY_KEY_ID must be a live key before taking real client payments."
      );
    }

    if (!webhookSecret) {
      addIssue(
        issues,
        "RAZORPAY_WEBHOOK_SECRET is required when online payment is enabled for a real client."
      );
    }
  }

  if (issues.length) {
    console.error("");
    console.error("First-client launch blockers:");
    issues.forEach((issue) => console.error(`- ${issue}`));
    if (warnings.length) {
      console.warn("");
      console.warn("Warnings:");
      warnings.forEach((warning) => console.warn(`- ${warning}`));
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("First-client launch profile looks ready.");
  if (warnings.length) {
    console.warn("");
    console.warn("Warnings:");
    warnings.forEach((warning) => console.warn(`- ${warning}`));
  }
}

main();
