const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_ROOT = path.join(PROJECT_ROOT, "frontend");
const TARGET_PAGES = [
  { pageName: "index.html", requireContactSheetTag: true, requirePolicyTags: true },
  { pageName: "menu.html", requireContactSheetTag: false, requirePolicyTags: true },
  { pageName: "admin.html", requireContactSheetTag: false, requirePolicyTags: true },
  { pageName: "staff-orders.html", requireContactSheetTag: false, requirePolicyTags: true },
  { pageName: "order-tracking.html", requireContactSheetTag: false, requirePolicyTags: true },
  { pageName: "rooms.html", requireContactSheetTag: false, requirePolicyTags: false },
  { pageName: "kitchen-display.html", requireContactSheetTag: false, requirePolicyTags: false },
  { pageName: "qr-order-status.html", requireContactSheetTag: false, requirePolicyTags: false }
];
const OPTIONAL_BOOLEAN_FLAGS = [
  "app-allow-order-whatsapp-fallback-on-save-failure",
  "app-open-whatsapp-after-verified-online-payment"
];

function extractMetaContent(source, name) {
  const match = source.match(
    new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"\\s*\\/?>`, "i")
  );

  return match ? match[1].trim().toLowerCase() : null;
}

function main() {
  const issues = [];
  const observedFlags = new Map(
    OPTIONAL_BOOLEAN_FLAGS.map((name) => [name, new Set()])
  );

  TARGET_PAGES.forEach(({ pageName, requireContactSheetTag, requirePolicyTags }) => {
    const source = fs.readFileSync(path.join(FRONTEND_ROOT, pageName), "utf8");
    const backendUrl = extractMetaContent(source, "app-backend-base-url");
    const apiUrl = extractMetaContent(source, "app-api-base-url");
    const contactUrl = extractMetaContent(source, "app-contact-sheet-url");
    const roomCheckout = extractMetaContent(
      source,
      "app-room-combined-checkout-frontend-enabled"
    );

    if (backendUrl === null || backendUrl !== "") {
      issues.push(`${pageName} must have a blank app-backend-base-url.`);
    }

    if (apiUrl === null || apiUrl !== "") {
      issues.push(`${pageName} must have a blank app-api-base-url.`);
    }

    if (requireContactSheetTag && (contactUrl === null || contactUrl !== "")) {
      issues.push(`${pageName} must have a blank app-contact-sheet-url.`);
    }

    if (requirePolicyTags) OPTIONAL_BOOLEAN_FLAGS.forEach((name) => {
      const value = extractMetaContent(source, name);

      if (value === null || !["", "true", "false"].includes(value)) {
        issues.push(`${pageName} ${name} must be blank, true, or false.`);
        return;
      }

      observedFlags.get(name).add(value);
    });

    if (requirePolicyTags && roomCheckout !== "false") {
      issues.push(
        `${pageName} app-room-combined-checkout-frontend-enabled must remain false in source-safe state.`
      );
    }
  });

  observedFlags.forEach((values, name) => {
    if (values.size > 1) {
      issues.push(`${name} must use one consistent value across all frontend pages.`);
    }
  });

  if (issues.length) {
    console.error("[verify-frontend-runtime-config-source-safe] Failed.");
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }

  console.log("[verify-frontend-runtime-config-source-safe] Passed.");
  console.log(
    "No environment URLs are embedded; explicit non-secret feature policies are consistent."
  );
}

main();
