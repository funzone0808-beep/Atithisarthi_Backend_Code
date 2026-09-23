require("dotenv").config({ path: ".env" });

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_ROOT = path.join(PROJECT_ROOT, "frontend");
const TARGET_PAGES = [
  "index.html",
  "menu.html",
  "admin.html",
  "staff-orders.html",
  "order-tracking.html",
  "rooms.html",
  "kitchen-display.html",
  "qr-order-status.html"
];

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function cleanText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeBooleanText(value, fallback = "true") {
  const normalizedValue = cleanText(value, fallback).toLowerCase();

  if (normalizedValue === "false") {
    return "false";
  }

  return "true";
}

function stripTrailingSlashes(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeUrl(value, fallback = "") {
  const normalized = cleanText(value, fallback);
  return normalized ? stripTrailingSlashes(normalized) : "";
}

function deriveApiBaseUrl(backendBaseUrl = "") {
  const normalizedBackendBaseUrl = normalizeUrl(backendBaseUrl);
  return normalizedBackendBaseUrl ? `${normalizedBackendBaseUrl}/api` : "";
}

function escapeHtmlAttribute(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function replaceMetaContent(source, name, value, { required = true } = {}) {
  const pattern = new RegExp(
    `(<meta\\s+name="${name}"\\s+content=")([^"]*)("\\s*\\/?>)`,
    "i"
  );

  if (!pattern.test(source)) {
    if (required) {
      throw new Error(
        `Missing required runtime meta tag: <meta name="${name}" ...>`
      );
    }

    return source;
  }

  return source.replace(
    pattern,
    `$1${escapeHtmlAttribute(value)}$3`
  );
}

function updatePageRuntimeConfig(filePath, runtimeConfig) {
  const originalSource = fs.readFileSync(filePath, "utf8");
  let nextSource = replaceMetaContent(
    originalSource,
    "app-backend-base-url",
    runtimeConfig.backendBaseUrl
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-api-base-url",
    runtimeConfig.apiBaseUrl
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-contact-sheet-url",
    runtimeConfig.contactSheetUrl,
    { required: false }
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-allow-order-whatsapp-fallback-on-save-failure",
    runtimeConfig.allowOrderWhatsAppFallbackOnSaveFailure,
    { required: false }
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-open-whatsapp-after-verified-online-payment",
    runtimeConfig.openWhatsAppAfterVerifiedOnlinePayment,
    { required: false }
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-room-combined-checkout-frontend-enabled",
    runtimeConfig.roomCombinedCheckoutFrontendEnabled,
    { required: false }
  );

  if (nextSource !== originalSource) {
    fs.writeFileSync(filePath, nextSource, "utf8");
    return true;
  }

  return false;
}

function main() {
  const backendBaseUrl = normalizeUrl(getEnv("APP_BACKEND_BASE_URL"));
  const apiBaseUrl = normalizeUrl(
    getEnv("APP_API_BASE_URL"),
    deriveApiBaseUrl(backendBaseUrl)
  );
  const contactSheetUrl = cleanText(getEnv("APP_CONTACT_SHEET_URL"));
  const allowOrderWhatsAppFallbackOnSaveFailure = normalizeBooleanText(
    getEnv("APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE"),
    "true"
  );
  const openWhatsAppAfterVerifiedOnlinePayment = normalizeBooleanText(
    getEnv("APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT"),
    "false"
  );
  const roomCombinedCheckoutFrontendEnabled = normalizeBooleanText(
    getEnv("APP_ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED"),
    "false"
  );

  if (!backendBaseUrl) {
    throw new Error("APP_BACKEND_BASE_URL is required.");
  }

  if (!apiBaseUrl) {
    throw new Error(
      "APP_API_BASE_URL is required, or APP_BACKEND_BASE_URL must be set so it can be derived."
    );
  }

  const runtimeConfig = {
    backendBaseUrl,
    apiBaseUrl,
    contactSheetUrl,
    allowOrderWhatsAppFallbackOnSaveFailure,
    openWhatsAppAfterVerifiedOnlinePayment,
    roomCombinedCheckoutFrontendEnabled
  };

  const changedPages = [];

  TARGET_PAGES.forEach((pageName) => {
    const filePath = path.join(FRONTEND_ROOT, pageName);
    const changed = updatePageRuntimeConfig(filePath, runtimeConfig);

    if (changed) {
      changedPages.push(pageName);
    }
  });

  console.log(
    `[prepare-frontend-runtime-config] Updated runtime config meta tags for ${changedPages.length}/${TARGET_PAGES.length} page(s).`
  );

  changedPages.forEach((pageName) => {
    console.log(`- ${pageName}`);
  });
}

main();
