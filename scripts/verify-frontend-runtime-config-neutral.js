const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_ROOT = path.join(PROJECT_ROOT, "frontend");
const TARGET_PAGES = [
  {
    pageName: "index.html",
    requireContactSheetTag: true
  },
  {
    pageName: "menu.html",
    requireContactSheetTag: false
  },
  {
    pageName: "admin.html",
    requireContactSheetTag: false
  },
  {
    pageName: "staff-orders.html",
    requireContactSheetTag: false
  },
  {
    pageName: "order-tracking.html",
    requireContactSheetTag: false
  }
];

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

  TARGET_PAGES.forEach(({ pageName, requireContactSheetTag }) => {
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
    } else if (backendMetaValue !== "") {
      addIssue(
        issues,
        `${pageName} app-backend-base-url should be blank in the neutral repo state.`
      );
    }

    if (apiMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-api-base-url">.`
      );
    } else if (apiMetaValue !== "") {
      addIssue(
        issues,
        `${pageName} app-api-base-url should be blank in the neutral repo state.`
      );
    }

    if (requireContactSheetTag) {
      if (contactSheetMetaValue === null) {
        addIssue(
          issues,
          `${pageName} is missing <meta name="app-contact-sheet-url">.`
        );
      } else if (contactSheetMetaValue !== "") {
        addIssue(
          issues,
          `${pageName} app-contact-sheet-url should be blank in the neutral repo state.`
        );
      }
    }

    if (orderFallbackMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-allow-order-whatsapp-fallback-on-save-failure">.`
      );
    } else if (orderFallbackMetaValue !== "") {
      addIssue(
        issues,
        `${pageName} app-allow-order-whatsapp-fallback-on-save-failure should be blank in the neutral repo state.`
      );
    }

    if (verifiedPaymentWhatsAppMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-open-whatsapp-after-verified-online-payment">.`
      );
    } else if (verifiedPaymentWhatsAppMetaValue !== "") {
      addIssue(
        issues,
        `${pageName} app-open-whatsapp-after-verified-online-payment should be blank in the neutral repo state.`
      );
    }

    if (roomCombinedCheckoutFrontendMetaValue === null) {
      addIssue(
        issues,
        `${pageName} is missing <meta name="app-room-combined-checkout-frontend-enabled">.`
      );
    } else if (roomCombinedCheckoutFrontendMetaValue !== "false") {
      addIssue(
        issues,
        `${pageName} app-room-combined-checkout-frontend-enabled should be false in the neutral repo state.`
      );
    }
  });

  if (issues.length) {
    console.error("[verify-frontend-runtime-config-neutral] Failed.");
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }

  console.log("[verify-frontend-runtime-config-neutral] Passed.");
}

main();
