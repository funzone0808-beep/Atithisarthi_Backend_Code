"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const frontendRoot = path.join(projectRoot, "frontend");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function stripHtmlComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, "");
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : "";
}

function getSingleLineDuplicateSelectors(css) {
  const selectors = new Map();

  css.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*([^@/][^{}]*?)\s*\{\s*$/);
    if (!match) return;
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (!selector || /^(from|to|\d+%)$/.test(selector)) return;
    const lines = selectors.get(selector) || [];
    lines.push(index + 1);
    selectors.set(selector, lines);
  });

  return [...selectors.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([selector, lines]) => ({ selector, lines }));
}

const html = read("frontend/index.html");
const activeHtml = stripHtmlComments(html);
const css = read("frontend/css/style.css");
const mainJs = read("frontend/js/main.js");
const dataLoaderJs = read("frontend/js/data-loader.js");
const threeSceneJs = read("frontend/js/three-scene.js");
const publicRoutes = read("backend/routes/public.js");
const publicRoomRoutes = read("backend/routes/public-room-booking.js");

assert.match(html, /^<!DOCTYPE html>/i);
assert.match(html, /<body class="public-home-page app-booting">/);
assert.strictEqual((activeHtml.match(/<main\b/g) || []).length, 1, "Expected exactly one main landmark");
assert.strictEqual((activeHtml.match(/<h1\b/g) || []).length, 1, "Expected exactly one H1");
assert.match(html, /class="skip-link" href="#mainContent"/);
assert.match(
  html,
  /id="notificationRegion" class="notification-region" aria-live="polite" aria-atomic="false"/
);

const ids = [...activeHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.strictEqual(new Set(ids).size, ids.length, "Duplicate HTML IDs found");
const idSet = new Set(ids);

for (const tag of activeHtml.match(/<[^>]+>/g) || []) {
  for (const attribute of ["for", "aria-controls", "aria-labelledby", "aria-describedby"]) {
    const value = getAttribute(tag, attribute);
    if (!value) continue;
    for (const id of value.split(/\s+/).filter(Boolean)) {
      assert(idSet.has(id), `${attribute} references missing ID: ${id}`);
    }
  }
}

const styleHrefs = (html.match(/<link\b[^>]*>/g) || [])
  .filter((tag) => getAttribute(tag, "rel") === "stylesheet")
  .map((tag) => getAttribute(tag, "href"));
assert.deepStrictEqual(styleHrefs, [
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,600&family=Jost:wght@300;400;500;600&display=swap",
  "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css",
  "css/style.css"
]);

const scripts = [...activeHtml.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)><\/script>/g)]
  .map((match) => ({ src: match[2], attributes: `${match[1]} ${match[3]}` }));
assert.deepStrictEqual(scripts.map((script) => script.src), [
  "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
  "https://cdn.jsdelivr.net/npm/gsap@3.12.4/dist/gsap.min.js",
  "https://cdn.jsdelivr.net/npm/gsap@3.12.4/dist/ScrollTrigger.min.js",
  "js/three-scene.js",
  "js/app-config.js",
  "js/data-loader.js",
  "js/review-avatar.js",
  "js/assistant-action-bridge.js",
  "js/main.js"
]);
scripts.forEach((script) => {
  assert(/\bdefer\b/.test(script.attributes), `Render-blocking script found: ${script.src}`);
});

const activeImages = activeHtml.match(/<img\b[^>]*>/g) || [];
assert(activeImages.length > 0);
activeImages.forEach((tag) => {
  assert(/\bwidth="\d+"/.test(tag), `Image missing intrinsic width: ${tag}`);
  assert(/\bheight="\d+"/.test(tag), `Image missing intrinsic height: ${tag}`);
});

const localImageSources = activeImages
  .map((tag) => getAttribute(tag, "src"))
  .filter((src) => src.startsWith("img/"));
localImageSources.forEach((src) => {
  assert(fs.existsSync(path.join(frontendRoot, src)), `Missing local image: ${src}`);
});
assert(localImageSources.filter((src) => src.endsWith(".png")).length === 0);

const originalImageNames = [
  "eventarea1.png",
  "eventarea3.png",
  "1.png",
  "3.png",
  "4.png",
  "8.png",
  "7.png"
];
const optimizedImageNames = originalImageNames.map((name) => name.replace(/\.png$/, ".webp"));
const originalImageBytes = originalImageNames.reduce(
  (total, name) => total + fs.statSync(path.join(frontendRoot, "img", name)).size,
  0
);
const optimizedImageBytes = optimizedImageNames.reduce(
  (total, name) => total + fs.statSync(path.join(frontendRoot, "img", name)).size,
  0
);
assert(
  optimizedImageBytes <= originalImageBytes * 0.2,
  "Optimized public images exceed the 20% payload budget"
);

assert.strictEqual(
  (css.match(/\{/g) || []).length,
  (css.match(/\}/g) || []).length,
  "Stylesheet braces are unbalanced"
);
assert.match(css, /--z-header:\s*100;/);
assert.match(css, /--z-modal:\s*1000;/);
assert.match(css, /--z-toast:\s*1100;/);
assert.match(css, /--z-loader:\s*1200;/);
assert.doesNotMatch(css, /z-index:\s*(?:[2-9]\d{4,}|\d{6,})\s*;/);
assert.doesNotMatch(css, /\.custom-popup-alert/);
assert.doesNotMatch(css, /\.global-toast/);
assert.match(css, /\.notification-region\s*\{/);
assert.match(css, /top:\s*calc\(var\(--nav-h\) \+ 14px\)/);
assert.match(css, /\.notification-toast__message[\s\S]*?overflow-wrap|\.notification-toast[\s\S]*?overflow-wrap/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.notification-region/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /\.wa-fallback\s*\{[\s\S]*?z-index:\s*var\(--z-modal\)/);
assert.match(css, /\.hotel-popup\s*\{[\s\S]*?overflow-y:\s*auto/);
assert.match(css, /section\[id\][\s\S]*?scroll-margin-top/);
assert.doesNotMatch(css, /width:\s*100vw\s*;/);

const toastStart = mainJs.indexOf("function showToast(");
const toastEnd = mainJs.indexOf("function ensureMenuAssistantStyles", toastStart);
assert(toastStart >= 0 && toastEnd > toastStart, "Notification API not found");
const toastCode = mainJs.slice(toastStart, toastEnd);
assert.match(toastCode, /textContent\s*=/);
assert.doesNotMatch(toastCode, /\.innerHTML\s*=/);
assert.match(mainJs, /const ACTIVE_NOTIFICATIONS = new Map\(\)/);
assert.match(mainJs, /while \(region\.children\.length >= 4\)/);
assert.match(mainJs, /dedupeKey/);
assert.match(mainJs, /function getPublicNotificationMessage\(/);
assert.match(toastCode, /getPublicNotificationMessage\(config\.message\)/);
assert.match(mainJs, /getSafePublicNavigationUrl\(notification\.ctaLink\)/);
assert.match(mainJs, /e\.key !== "Tab"/);
assert.doesNotMatch(mainJs, /console\.log\("APP_STATE:"/);
assert.doesNotMatch(mainJs, /console\.log\("App data loaded successfully"/);

const loaderStart = mainJs.indexOf("(function initLoader()");
const loaderEnd = mainJs.indexOf("(function initCursor()", loaderStart);
const loaderCode = mainJs.slice(loaderStart, loaderEnd);
assert(loaderStart >= 0 && loaderEnd > loaderStart, "Loader block not found");
assert.doesNotMatch(loaderCode, /setInterval|setTimeout/);
assert.match(loaderCode, /document\.addEventListener\("app:ready"/);
assert.match(mainJs, /const publicRoomsPromise = initPublicRoomsSection\(\)/);
assert.doesNotMatch(mainJs, /await initPublicRoomsSection\(\)/);
assert.match(mainJs, /markAppReady\(\);\s*void hydrateSecondaryPublicContent/);
assert.match(dataLoaderJs, /window\.APP_SECONDARY_DATA_PROMISE = secondaryDataPromise/);
assert.match(dataLoaderJs, /secondaryDataReady = true/);

assert.match(threeSceneJs, /document\.addEventListener\("app:ready", startHeroScene/);
assert.match(threeSceneJs, /prefers-reduced-motion: reduce/);
assert.match(threeSceneJs, /navigator\.connection\?\.saveData/);
assert.match(threeSceneJs, /IntersectionObserver/);
assert.match(mainJs, /createRafThrottled/);
assert.doesNotMatch(
  mainJs.slice(mainJs.indexOf("(function initHeroGradient()"), mainJs.indexOf("19. COUNTER ANIMATION")),
  /,\s*50\)/
);

assert.match(mainJs, /width="640"\s+height="440"/);
assert.match(mainJs, /width="1376" height="768"/);
assert.match(mainJs, /width="96" height="96"/);
assert.match(mainJs, /width="320" height="213"/);
assert.match(mainJs, /width="960" height="640"/);

const importantCount = (css.match(/!important/g) || []).length;
assert(importantCount <= 33, `Unexpected !important growth: ${importantCount}`);
assert.match(
  css,
  /:where\(\.public-home-page, \.menu-page\) \.menu-card\s*\{[\s\S]*?!important/
);

assert.match(publicRoutes, /PUBLIC_ROUTE_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120"/);
assert.match(publicRoomRoutes, /PUBLIC_ROOM_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120"/);
assert.match(publicRoutes, /\.eq\("hotel_slug", (?:hotelSlug|slug)\)/);

const duplicateSelectors = getSingleLineDuplicateSelectors(css);
const localJsBytes = [
  "three-scene.js",
  "app-config.js",
  "data-loader.js",
  "review-avatar.js",
  "assistant-action-bridge.js",
  "main.js"
].reduce((total, name) => total + fs.statSync(path.join(frontendRoot, "js", name)).size, 0);

console.log("Public frontend production verification passed.");
console.log(
  JSON.stringify(
    {
      htmlBytes: Buffer.byteLength(html),
      cssBytes: Buffer.byteLength(css),
      localJsBytes,
      originalImageBytes,
      optimizedImageBytes,
      imageReductionPercent: Number(
        ((1 - optimizedImageBytes / originalImageBytes) * 100).toFixed(1)
      ),
      importantCount,
      reviewedDuplicateSelectorCount: duplicateSelectors.length,
      scriptsDeferred: scripts.length,
      activeStaticImagesWithDimensions: activeImages.length
    },
    null,
    2
  )
);
