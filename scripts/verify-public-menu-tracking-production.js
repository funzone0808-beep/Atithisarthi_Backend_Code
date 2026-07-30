"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const frontendRoot = path.join(projectRoot, "frontend");
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

const menuHtml = read("frontend/menu.html");
const trackingHtml = read("frontend/order-tracking.html");
const menuCss = read("frontend/css/menu-page.css");
const trackingCss = read("frontend/css/order-tracking.css");
const sharedCss = read("frontend/css/style.css");
const mainJs = read("frontend/js/main.js");
const trackingJs = read("frontend/js/order-tracking.js");

function activeMarkup(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function getIds(html) {
  return [...activeMarkup(html).matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => match[1]
  );
}

function assertUniqueIds(html, label) {
  const ids = getIds(html);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepStrictEqual([...new Set(duplicates)], [], `${label} contains duplicate IDs`);
}

function getStylesheets(html) {
  return [...activeMarkup(html).matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)]
    .map((match) => match[0].match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
}

function getScripts(html) {
  return [...activeMarkup(html).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
    .map((match) => ({ src: match[1], tag: match[0] }));
}

assertUniqueIds(menuHtml, "menu.html");
assertUniqueIds(trackingHtml, "order-tracking.html");

assert.deepStrictEqual(getStylesheets(menuHtml), [
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600&family=Jost:wght@300;400;500;600&display=swap",
  "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css",
  "css/style.css",
  "css/menu-page.css"
]);
assert.deepStrictEqual(getStylesheets(trackingHtml), [
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600&family=Jost:wght@300;400;500;600&display=swap",
  "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css",
  "css/style.css",
  "css/order-tracking.css"
]);

const menuScripts = getScripts(menuHtml);
const trackingScripts = getScripts(trackingHtml);
assert.deepStrictEqual(menuScripts.map(({ src }) => src), [
  "https://cdn.jsdelivr.net/npm/gsap@3.12.4/dist/gsap.min.js",
  "https://cdn.jsdelivr.net/npm/gsap@3.12.4/dist/ScrollTrigger.min.js",
  "js/app-config.js",
  "js/data-loader.js",
  "js/assistant-action-bridge.js",
  "js/main.js"
]);
assert.deepStrictEqual(trackingScripts.map(({ src }) => src), [
  "js/app-config.js",
  "js/assistant-action-bridge.js",
  "js/order-tracking.js"
]);
[...menuScripts, ...trackingScripts].forEach(({ src, tag }) => {
  assert(/\bdefer\b/i.test(tag), `${src} must be deferred`);
});

assert.match(menuHtml, /class="skip-link" href="#mainContent"/);
assert.match(menuHtml, /id="mainContent"[^>]*tabindex="-1"/);
assert.match(menuHtml, /id="notificationRegion"[^>]*aria-live="polite"/);
assert.match(menuHtml, /id="cartDrawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(menuHtml, /id="openCartBtn"[^>]*aria-expanded="false"[^>]*aria-controls="cartDrawer"/);
assert.match(menuHtml, /id="floatingCartBtn"[^>]*aria-expanded="false"[^>]*aria-controls="cartDrawer"/);
assert.match(trackingHtml, /class="skip-link" href="#trackingMain"/);
assert.match(trackingHtml, /id="trackingMain"[^>]*tabindex="-1"/);
assert.match(trackingHtml, /id="trackingStatusBadge"[^>]*role="status"[^>]*aria-live="polite"/);

assert.match(sharedCss, /--z-floating:\s*300;/);
assert.match(sharedCss, /--z-backdrop:\s*700;/);
assert.match(sharedCss, /--z-drawer:\s*800;/);
assert.match(menuCss, /body\.menu-page \.cart-backdrop\s*\{[\s\S]*?var\(--z-backdrop\)/);
assert.match(menuCss, /body\.menu-page \.cart-drawer\s*\{[\s\S]*?var\(--z-drawer\)/);
assert.match(menuCss, /body\.menu-page \.floating-cart-btn\s*\{[\s\S]*?var\(--z-floating\)/);
assert.doesNotMatch(menuCss, /z-index:\s*1002/);
assert.match(menuCss, /height:\s*100dvh/);
assert.match(menuCss, /overflow-wrap:\s*anywhere/);
assert.match(menuCss, /@media \(max-width: 520px\)/);
assert.match(menuCss, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(trackingCss, /overflow-wrap:\s*anywhere/);
assert.match(trackingCss, /\.tracking-card--hero\s*\{[\s\S]*?overflow:\s*hidden/);
assert.match(trackingCss, /\.tracking-card\s*\{[\s\S]*?overflow:\s*visible/);
assert.match(trackingCss, /@media \(max-width: 560px\)[\s\S]*?\.tracking-smart-waiter__head/);
assert.match(trackingCss, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(mainJs, /function handleCartDrawerKeydown\(event\)/);
assert.match(mainJs, /drawer\.setAttribute\("aria-hidden", "false"\)/);
assert.match(mainJs, /setCartDrawerExpanded\(true\)/);
assert.match(mainJs, /CART_DRAWER_LAST_FOCUSED/);
assert.match(mainJs, /event\.key === "Escape"/);

assert.match(trackingJs, /let trackingRequestInFlight = false/);
assert.match(trackingJs, /document\.visibilityState !== "visible"/);
assert.match(trackingJs, /document\.addEventListener\("visibilitychange"/);
assert.match(trackingJs, /function getPublicTrackingMessage\(/);
assert.match(trackingJs, /loader\.setAttribute\("aria-hidden", "true"\)/);
assert.match(
  trackingJs,
  /renderTrackingAssistantConfirmationPreview\(helperActions\);\s*reply\.hidden = false;/
);
assert.doesNotMatch(
  trackingJs,
  /return renderTrackingAssistantConfirmationPreview\(helperActions\);\s*reply\.hidden = false;/
);

const menuImportantCount = (menuCss.match(/!important/g) || []).length;
const trackingImportantCount = (trackingCss.match(/!important/g) || []).length;
assert(menuImportantCount <= 20, `Unexpected menu !important growth: ${menuImportantCount}`);
assert.strictEqual(trackingImportantCount, 0);

console.log("Public menu and order-tracking production verification passed.");
console.log(
  JSON.stringify(
    {
      menuHtmlBytes: Buffer.byteLength(menuHtml),
      trackingHtmlBytes: Buffer.byteLength(trackingHtml),
      menuCssBytes: Buffer.byteLength(menuCss),
      trackingCssBytes: Buffer.byteLength(trackingCss),
      menuScriptsDeferred: menuScripts.length,
      trackingScriptsDeferred: trackingScripts.length,
      menuImportantCount,
      trackingImportantCount,
      menuIds: getIds(menuHtml).length,
      trackingIds: getIds(trackingHtml).length
    },
    null,
    2
  )
);
