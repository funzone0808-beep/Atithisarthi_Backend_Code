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

  return source.replace(pattern, `$1${value}$3`);
}

function resetPageRuntimeConfig(filePath) {
  const originalSource = fs.readFileSync(filePath, "utf8");
  let nextSource = replaceMetaContent(
    originalSource,
    "app-backend-base-url",
    ""
  );

  nextSource = replaceMetaContent(nextSource, "app-api-base-url", "");
  nextSource = replaceMetaContent(
    nextSource,
    "app-contact-sheet-url",
    "",
    { required: false }
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-allow-order-whatsapp-fallback-on-save-failure",
    "",
    { required: false }
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-open-whatsapp-after-verified-online-payment",
    "",
    { required: false }
  );

  nextSource = replaceMetaContent(
    nextSource,
    "app-room-combined-checkout-frontend-enabled",
    "false",
    { required: false }
  );

  if (nextSource !== originalSource) {
    fs.writeFileSync(filePath, nextSource, "utf8");
    return true;
  }

  return false;
}

function main() {
  const changedPages = [];

  TARGET_PAGES.forEach((pageName) => {
    const filePath = path.join(FRONTEND_ROOT, pageName);
    const changed = resetPageRuntimeConfig(filePath);

    if (changed) {
      changedPages.push(pageName);
    }
  });

  console.log(
    `[reset-frontend-runtime-config] Reset runtime config meta tags for ${changedPages.length}/${TARGET_PAGES.length} page(s).`
  );

  changedPages.forEach((pageName) => {
    console.log(`- ${pageName}`);
  });
}

main();
