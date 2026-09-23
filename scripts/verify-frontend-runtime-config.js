require("dotenv").config({ path: ".env" });

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_ROOT = path.join(PROJECT_ROOT, "frontend");
const LEGACY_PRODUCTION_BACKEND_URL =
  "https://my-projectbackendpaymentgateway-production.up.railway.app";
const TARGET_PAGES = [
  {
    pageName: "index.html",
    requireContactSheetTag: true,
    requirePolicyTags: true
  },
  {
    pageName: "menu.html",
    requireContactSheetTag: false,
    requirePolicyTags: true
  },
  {
    pageName: "admin.html",
    requireContactSheetTag: false,
    requirePolicyTags: true
  },
  {
    pageName: "staff-orders.html",
    requireContactSheetTag: false,
    requirePolicyTags: true
  },
  {
    pageName: "order-tracking.html",
    requireContactSheetTag: false,
    requirePolicyTags: true
  },
  {
    pageName: "rooms.html",
    requireContactSheetTag: false,
    requirePolicyTags: false
  },
  {
    pageName: "kitchen-display.html",
    requireContactSheetTag: false,
    requirePolicyTags: false
  },
  {
    pageName: "qr-order-status.html",
    requireContactSheetTag: false,
    requirePolicyTags: false
  }
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

function normalizeUrl(value, fallback = "") {
  const normalizedValue = cleanText(value, fallback);
  return normalizedValue ? normalizedValue.replace(/\/+$/, "") : "";
}

function deriveApiBaseUrl(backendBaseUrl = "") {
  return backendBaseUrl ? `${backendBaseUrl}/api` : "";
}

function isLegacyBackendUrl(value = "") {
  return (
    value === LEGACY_PRODUCTION_BACKEND_URL ||
    value.startsWith(`${LEGACY_PRODUCTION_BACKEND_URL}/`)
  );
}

function isLocalUrl(value = "") {
  return /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(
    String(value || "")
  );
}

function extractMetaContent(source, name) {
  const match = source.match(
    new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"\\s*\\/?>`, "i")
  );

  return match ? match[1].trim() : null;
}

function addIssue(list, message) {
  list.push(message);
}

function main() {
  const issues = [];
  const warnings = [];
  const expectedBackendBaseUrl = normalizeUrl(getEnv("APP_BACKEND_BASE_URL"));
  const expectedApiBaseUrl = normalizeUrl(
    getEnv("APP_API_BASE_URL"),
    deriveApiBaseUrl(expectedBackendBaseUrl)
  );
  const expectedContactSheetUrl = cleanText(getEnv("APP_CONTACT_SHEET_URL"));
  const expectedAllowOrderWhatsAppFallbackOnSaveFailure = normalizeBooleanText(
    getEnv("APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE"),
    "true"
  );
  const expectedOpenWhatsAppAfterVerifiedOnlinePayment = normalizeBooleanText(
    getEnv("APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT"),
    "false"
  );
  const expectedRoomCombinedCheckoutFrontendEnabled = normalizeBooleanText(
    getEnv("APP_ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED"),
    "false"
  );
  const allowedLegacyRuntimeValues = new Set(
    [expectedBackendBaseUrl, expectedApiBaseUrl].filter(Boolean)
  );
  const isProductionLike =
    cleanText(getEnv("NODE_ENV")).toLowerCase() === "production";

  if (!expectedBackendBaseUrl) {
    addIssue(issues, "APP_BACKEND_BASE_URL is required.");
  }

  if (!expectedApiBaseUrl) {
    addIssue(
      issues,
      "APP_API_BASE_URL is required, or APP_BACKEND_BASE_URL must be set so it can be derived."
    );
  }

  TARGET_PAGES.forEach(({ pageName, requireContactSheetTag, requirePolicyTags }) => {
    const filePath = path.join(FRONTEND_ROOT, pageName);
    const source = fs.readFileSync(filePath, "utf8");
    const backendMetaValue = extractMetaContent(source, "app-backend-base-url");
    const apiMetaValue = extractMetaContent(source, "app-api-base-url");
    const contactSheetMetaValue = extractMetaContent(
      source,
      "app-contact-sheet-url"
    );
    const orderFallbackMetaValue = extractMetaContent(
      source,
      "app-allow-order-whatsapp-fallback-on-save-failure"
    );
    const verifiedPaymentWhatsAppMetaValue = extractMetaContent(
      source,
      "app-open-whatsapp-after-verified-online-payment"
    );
    const roomCombinedCheckoutFrontendMetaValue = extractMetaContent(
      source,
      "app-room-combined-checkout-frontend-enabled"
    );

    if (backendMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-backend-base-url">.`
      );
    } else if (backendMetaValue !== expectedBackendBaseUrl) {
      addIssue(
        issues,
        `${pageName} app-backend-base-url does not match APP_BACKEND_BASE_URL.`
      );
    }

    if (apiMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-api-base-url">.`
      );
    } else if (apiMetaValue !== expectedApiBaseUrl) {
      addIssue(
        issues,
        `${pageName} app-api-base-url does not match APP_API_BASE_URL.`
      );
    }

    if (requireContactSheetTag) {
      if (contactSheetMetaValue === null) {
        addIssue(
          issues,
          `${pageName} is missing <meta name="app-contact-sheet-url">.`
        );
      } else if (contactSheetMetaValue !== expectedContactSheetUrl) {
        addIssue(
          issues,
          `${pageName} app-contact-sheet-url does not match APP_CONTACT_SHEET_URL.`
        );
      }
    }

    if (requirePolicyTags && orderFallbackMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-allow-order-whatsapp-fallback-on-save-failure">.`
      );
    } else if (requirePolicyTags &&
      orderFallbackMetaValue !== expectedAllowOrderWhatsAppFallbackOnSaveFailure
    ) {
      addIssue(
        issues,
        `${pageName} app-allow-order-whatsapp-fallback-on-save-failure does not match APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE.`
      );
    }

    if (requirePolicyTags && verifiedPaymentWhatsAppMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-open-whatsapp-after-verified-online-payment">.`
      );
    } else if (requirePolicyTags &&
      verifiedPaymentWhatsAppMetaValue !== expectedOpenWhatsAppAfterVerifiedOnlinePayment
    ) {
      addIssue(
        issues,
        `${pageName} app-open-whatsapp-after-verified-online-payment does not match APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT.`
      );
    }

    if (requirePolicyTags && roomCombinedCheckoutFrontendMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-room-combined-checkout-frontend-enabled">.`
      );
    } else if (requirePolicyTags &&
      roomCombinedCheckoutFrontendMetaValue !== expectedRoomCombinedCheckoutFrontendEnabled
    ) {
      addIssue(
        issues,
        `${pageName} app-room-combined-checkout-frontend-enabled does not match APP_ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED.`
      );
    }

    [backendMetaValue, apiMetaValue].forEach((value) => {
      if (!value) {
        return;
      }

      if (isLegacyBackendUrl(value) && !allowedLegacyRuntimeValues.has(value)) {
        addIssue(
          issues,
          `${pageName} still points to the legacy Railway backend fallback.`
        );
      }

      if (isProductionLike && isLocalUrl(value)) {
        addIssue(
          issues,
          `${pageName} points to localhost while NODE_ENV=production.`
        );
      }
    });

    if (
      backendMetaValue &&
      apiMetaValue &&
      apiMetaValue !== deriveApiBaseUrl(backendMetaValue)
    ) {
      warnings.push(
        `${pageName} app-api-base-url does not follow the usual backend + /api pattern. Confirm this split is intentional.`
      );
    }
  });

  if (issues.length) {
    console.error("[verify-frontend-runtime-config] Failed.");
    issues.forEach((issue) => console.error(`- ${issue}`));

    if (warnings.length) {
      console.warn("[verify-frontend-runtime-config] Warnings:");
      warnings.forEach((warning) => console.warn(`- ${warning}`));
    }

    process.exitCode = 1;
    return;
  }

  console.log("[verify-frontend-runtime-config] Passed.");

  if (warnings.length) {
    console.warn("[verify-frontend-runtime-config] Warnings:");
    warnings.forEach((warning) => console.warn(`- ${warning}`));
  }
}

main();
