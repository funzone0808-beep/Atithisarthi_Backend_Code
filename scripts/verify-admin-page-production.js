"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const frontendRoot = path.join(root, "frontend");
const adminHtml = fs.readFileSync(path.join(frontendRoot, "admin.html"), "utf8");
const adminCss = fs.readFileSync(path.join(frontendRoot, "css", "admin.css"), "utf8");
const adminJs = fs.readFileSync(path.join(frontendRoot, "js", "admin.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getIds(html) {
  return [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
}

const ids = getIds(adminHtml);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
const scriptTags = [...adminHtml.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)];
const scriptSources = scriptTags.map((match) => match[1]);

assert(duplicateIds.length === 0, `Duplicate admin IDs: ${[...new Set(duplicateIds)].join(", ")}`);
assert(/<body\s+class=["'][^"']*\badmin-page\b/i.test(adminHtml), "Admin page scope class is missing.");
assert(/name=["']referrer["'][^>]+content=["']no-referrer["']/i.test(adminHtml), "Admin referrer policy is missing.");
assert(adminHtml.includes('id="adminBootStatus"'), "Admin boot status is missing.");
assert(adminHtml.includes('class="admin-skip-link"'), "Admin skip links are missing.");
assert(/<label[^>]+for=["']adminEmailInput["']/i.test(adminHtml), "Admin email label is missing.");
assert(/<label[^>]+for=["']adminPasswordInput["']/i.test(adminHtml), "Admin password label is missing.");
assert(/<label[^>]+for=["']hotelFilter["']/i.test(adminHtml), "Hotel scope label is missing.");
assert(/id=["']adminContent["'][^>]+aria-busy=["']true["']/i.test(adminHtml), "Admin content busy state is missing.");

assert(
  scriptSources.join("|") ===
    [
      "js/app-config.js",
      "js/login-branding.js",
      "js/room-checkout-receipt.js",
      "js/admin.js",
      "js/admin-login-branding.js"
    ].join("|"),
  "Admin script order changed."
);
assert(scriptTags.every((match) => /\bdefer\b/i.test(match[0])), "Every admin script must be deferred.");

const receiptCssIndex = adminHtml.indexOf('href="css/room-checkout-receipt.css"');
const adminCssIndex = adminHtml.indexOf('href="css/admin.css"');
assert(receiptCssIndex >= 0 && adminCssIndex > receiptCssIndex, "Admin safety CSS must load last.");
assert(!adminCss.includes("!important"), "Admin safety CSS must not use !important.");
assert(adminCss.includes('section.admin-card[id$="Section"]'), "Editor panel scroll override is missing.");
assert(/max-height:\s*none/.test(adminCss), "Nested editor max-height was not removed.");
assert(/overflow-wrap:\s*anywhere/.test(adminCss), "Long-content wrapping protection is missing.");
assert(/@media\s*\(max-width:\s*420px\)/.test(adminCss), "Small-mobile admin breakpoint is missing.");
assert(/prefers-reduced-motion/.test(adminCss), "Reduced-motion support is missing.");

const dataTabButtons = [...adminHtml.matchAll(/<button\b[^>]*\bdata-tab=["'][^"']+["'][^>]*>/gi)];
assert(dataTabButtons.length === 12, `Expected 12 admin data tabs, found ${dataTabButtons.length}.`);
assert(
  dataTabButtons.every(
    (match) =>
      /\btype=["']button["']/i.test(match[0]) &&
      /\brole=["']tab["']/i.test(match[0]) &&
      /\baria-selected=["'](?:true|false)["']/i.test(match[0])
  ),
  "Admin data tabs need explicit type and selected-state semantics."
);

assert(adminJs.includes("let adminTabLoadController = null;"), "Admin tab request controller is missing.");
assert(adminJs.includes("adminTabLoadController.abort();"), "Previous admin tab requests are not cancelled.");
assert(adminJs.includes('error?.name === "AbortError"'), "Cancelled admin loads are not handled safely.");
assert(adminJs.includes('content?.setAttribute("aria-busy", "true")'), "Admin busy state is not enabled.");
assert(adminJs.includes('content?.setAttribute("aria-busy", "false")'), "Admin busy state is not cleared.");
assert(adminJs.includes('btn.setAttribute("aria-selected"'), "Admin tab ARIA state is not synchronized.");
assert(adminJs.includes('event.key === "ArrowRight"'), "Admin tab arrow-key navigation is missing.");
assert(adminJs.includes('event.key === "Home"'), "Admin tab Home/End navigation is missing.");
assert(adminJs.includes('document.getElementById("adminLoginStatus")'), "Inline login status is not wired.");
assert(adminJs.includes('const ADMIN_TOKEN_KEY = "hotel_platform_admin_token";'), "Admin token key changed.");
assert(adminJs.includes("const API_BASE = `${BASE_API}/admin`;"), "Admin API base changed.");
assert(adminJs.includes("await loadHotels();"), "Admin hotel initialization flow changed.");
assert(adminJs.includes("await loadTabData();"), "Admin tab initialization flow changed.");

console.log("Admin page production verification passed.");
console.log(
  JSON.stringify(
    {
      adminHtmlBytes: Buffer.byteLength(adminHtml),
      adminCssBytes: Buffer.byteLength(adminCss),
      adminJsBytes: Buffer.byteLength(adminJs),
      ids: ids.length,
      scriptsDeferred: scriptTags.length,
      dataTabs: dataTabButtons.length,
      adminImportantCount: (adminCss.match(/!important/g) || []).length
    },
    null,
    2
  )
);
