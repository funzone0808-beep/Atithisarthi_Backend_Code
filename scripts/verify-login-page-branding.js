"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  loginBrandingConfigSchema,
  loginBrandingScopeSchema,
  loginBrandingImageDeleteSchema
} = require("../validators/login-branding");
const { getImageDimensions } = require("../utils/image-dimensions");
const {
  BUILT_IN_LOGIN_BRANDING,
  PUBLIC_LOGIN_BRANDING_KEYS,
  buildPublicLoginBranding
} = require("../utils/login-branding");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("backend/server.js");
const route = read("backend/routes/login-branding.js");
const staffHtml = read("frontend/staff-orders.html");
const staffJs = read("frontend/js/staff-orders.js");
const brandingJs = read("frontend/js/login-branding.js");
const brandingCss = read("frontend/css/staff-login-branding.css");
const adminHtml = read("frontend/admin.html");
const adminJs = read("frontend/js/admin-login-branding.js");
const adminCss = read("frontend/css/admin-login-branding.css");
const migration = read("backend/scripts/create-login-page-branding.sql");
const rollback = read("backend/scripts/rollback-login-page-branding.sql");

function makePng(width = 100, height = 50) {
  const buffer = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function makeJpeg(width = 100, height = 50) {
  const buffer = Buffer.alloc(17);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(11, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  buffer[15] = 0xff;
  buffer[16] = 0xd9;
  return buffer;
}

function makeWebp(width = 100, height = 50) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function verifyAuthenticationContract() {
  for (const id of ["staffLoginForm", "staffHotelSlugInput", "staffPinInput", "staffLoginStatus"]) {
    assert(staffHtml.includes(`id="${id}"`) || brandingJs.includes(`id="${id}"`), `Missing login ID: ${id}`);
  }
  assert(brandingJs.includes('name="hotelSlug"'), "Hotel Slug field name changed");
  assert(brandingJs.includes('name="pin"'), "Staff PIN field name changed");
  assert(staffJs.includes('fetch(`${STAFF_API_BASE}/login`'), "Staff login endpoint changed");
  assert(staffJs.includes("JSON.stringify({ hotelSlug, pin })"), "Staff login payload changed");
  assert(staffJs.includes('const STAFF_TOKEN_KEY = "hotel_platform_staff_token"'), "Staff token key changed");
  assert(staffJs.includes('staffFetchJson(`${STAFF_API_BASE}/me`)'), "Staff session endpoint changed");
  assert(staffJs.includes("showStaffDashboardView(result.staffUser || {})"), "Dashboard loading changed");
  assert(staffJs.includes('showStaffLoginView("Logged out.")'), "Logout return-to-login changed");
  assert(staffJs.includes('form.setAttribute("aria-busy"'), "Accessible login loading state missing");
  assert(staffJs.includes('pinInput.value = ""'), "PIN clearing policy missing");
}

function verifyBackendIntegration() {
  assert(server.includes('require("./routes/login-branding")'), "Branding route import missing");
  assert(server.includes('app.use("/api/public/login-branding", publicLoginBrandingRouter)'), "Public branding route not mounted");
  assert(server.includes('app.use("/api/admin/login-branding", adminLoginBrandingRouter)'), "Admin branding route not mounted");
  assert(
    server.indexOf('/api/admin/login-branding') < server.indexOf('app.use("/api/admin", adminRoute)'),
    "Admin branding route must be mounted before the general Admin router"
  );
  assert(route.includes("adminRouter.use(requireAdminAuth, requirePlatformBrandingAdmin)"), "Platform Admin authorization missing");
  assert(route.includes('req.adminUser?.scope !== "admin"'), "Exact Admin token scope check missing");
  assert(route.includes("publicBrandingLimiter"), "Public branding rate limiter missing");
  assert(route.includes('Cache-Control", "public, max-age=60, stale-while-revalidate=300'), "Public cache header missing");
  assert(route.includes("...BUILT_IN_LOGIN_BRANDING") && route.includes("...platformConfig") && route.includes("...hotelConfig"), "Branding precedence merge missing");
  assert(route.includes("buildPublicLoginBranding"), "Public field allowlist missing");
  assert(route.includes("isMissingLoginBrandingRelationError"), "Missing-migration fallback missing");
  assert(route.includes("getScopeStoragePrefix(scope)"), "Scope-owned storage prefix missing");
  assert(route.includes('storagePath.includes("..")'), "Traversal rejection missing");
  assert(route.includes("referencesImage(row.published_config)"), "Published-image deletion guard missing");
  assert(route.includes("draft_config: nextDraftConfig"), "Draft image reference cleanup missing");
}

function verifyValidationAndPublicShape() {
  const valid = loginBrandingConfigSchema.safeParse(BUILT_IN_LOGIN_BRANDING);
  assert(valid.success, valid.error?.issues?.[0]?.message || "Built-in branding must validate");
  assert(!loginBrandingConfigSchema.safeParse({ companyName: "<script>alert(1)</script>" }).success, "HTML injection accepted");
  assert(!loginBrandingConfigSchema.safeParse({ companyName: "Safe", unexpected: "field" }).success, "Unknown field accepted");
  assert(!loginBrandingConfigSchema.safeParse({ termsUrl: "javascript:alert(1)" }).success, "Unsafe legal URL accepted");
  assert(!loginBrandingConfigSchema.safeParse({ logoUrl: "data:image/svg+xml,test" }).success, "Unsafe display URL accepted");
  assert(!loginBrandingConfigSchema.safeParse({ primaryColor: "red" }).success, "Invalid color accepted");
  assert(loginBrandingConfigSchema.safeParse({ primaryColor: "#A05c3E" }).success, "Valid color rejected");
  assert(loginBrandingScopeSchema.safeParse({ scopeType: "platform" }).success, "Platform scope rejected");
  assert(loginBrandingScopeSchema.safeParse({ scopeType: "hotel", hotelSlug: "hotel-one" }).success, "Hotel scope rejected");
  assert(!loginBrandingScopeSchema.safeParse({ scopeType: "hotel", hotelSlug: "../hotel" }).success, "Traversal slug accepted");
  assert(!loginBrandingImageDeleteSchema.safeParse({ scopeType: "hotel", hotelSlug: "hotel-one", storagePath: "" }).success, "Empty delete path accepted");

  const publicShape = buildPublicLoginBranding({
    companyName: "Test Hotel",
    internalId: "secret",
    staffPin: "1234",
    audit: { actor: "hidden" }
  });
  assert.strictEqual(publicShape.companyName, "Test Hotel");
  assert(!("internalId" in publicShape));
  assert(!("staffPin" in publicShape));
  assert(!("audit" in publicShape));
  assert.deepStrictEqual(Object.keys(publicShape), [...PUBLIC_LOGIN_BRANDING_KEYS]);
}

function verifyImageInspection() {
  assert.deepStrictEqual(getImageDimensions(makePng(), "image/png"), { width: 100, height: 50, type: "png" });
  assert.deepStrictEqual(getImageDimensions(makeJpeg(), "image/jpeg"), { width: 100, height: 50, type: "jpeg" });
  assert.deepStrictEqual(getImageDimensions(makeWebp(), "image/webp"), { width: 100, height: 50, type: "webp" });
  assert.strictEqual(getImageDimensions(Buffer.from("MZ executable"), "image/png"), null, "Renamed executable accepted");
  assert.strictEqual(getImageDimensions(makePng().subarray(0, 24), "image/png"), null, "Truncated PNG accepted");
  assert.strictEqual(getImageDimensions(makeJpeg().subarray(0, 15), "image/jpeg"), null, "Truncated JPEG accepted");
  assert.strictEqual(getImageDimensions(makeWebp().subarray(0, 20), "image/webp"), null, "Truncated WebP accepted");
  assert.strictEqual(getImageDimensions(makePng(), "image/svg+xml"), null, "SVG accepted");
}

function verifyFrontendBranding() {
  assert(staffHtml.includes('href="css/staff-login-branding.css"'), "Prepared staff branding CSS is not linked");
  assert(staffHtml.includes('src="js/login-branding.js"'), "Public branding loader is not linked");
  assert(brandingJs.includes("applyBranding(root, FALLBACK)"), "Immediate fallback rendering missing");
  assert(brandingJs.includes("/public/login-branding"), "Public branding endpoint missing");
  assert(brandingJs.includes("window.setTimeout(() =>") && brandingJs.includes("}, 450)"), "Hotel Slug debounce missing");
  assert(brandingJs.includes("AbortController"), "Stale branding request cancellation missing");
  assert(!/staffPinInput[^]{0,100}\.value/.test(brandingJs), "Branding loader reads the Staff PIN");
  assert(!brandingJs.includes("localStorage"), "Branding loader must not use browser storage");
  assert(!brandingJs.includes("/staff/login"), "Branding loader must not call Staff login");
  assert(brandingJs.includes('rel="noopener noreferrer"'), "External legal link protection missing");
  for (const width of ["520px", "820px", "1024px"]) {
    assert(brandingCss.includes(`max-width: ${width}`), `Missing responsive breakpoint ${width}`);
  }
  assert(brandingCss.includes("prefers-reduced-motion"), "Reduced-motion support missing");
  assert(brandingCss.includes("grid-template-columns: minmax(0, 599px) minmax(420px, 512px)"), "Reference desktop proportions missing");
}

function verifyAdminEditor() {
  assert(adminHtml.includes('href="css/admin-login-branding.css"'), "Admin branding CSS is not linked");
  assert(adminHtml.includes('src="js/admin-login-branding.js"'), "Admin branding editor is not linked");
  for (const tab of ["content", "images", "login", "services", "footer", "theme", "preview"]) {
    assert(adminJs.includes(`"${tab}"`) || adminJs.includes(`-${tab}`), `Missing Admin tab: ${tab}`);
  }
  for (const action of ["Save Draft", "Publish", "Reset to Default", "Unsaved Preview"]) {
    assert(adminJs.includes(action), `Missing Admin action: ${action}`);
  }
  for (const field of [
    "companyName", "shortProductLabel", "logoUrl", "footerLogoUrl", "heroImageUrl",
    "backgroundImageUrl", "welcomeBadge", "loginHeading", "enableHotelService",
    "enableRestaurantService", "enableTransportService", "copyrightText", "termsUrl",
    "privacyUrl", "primaryColor", "textColor"
  ]) {
    assert(adminJs.includes(`"${field}"`), `Missing Admin field: ${field}`);
  }
  assert(adminJs.includes('const TOKEN_KEY = "hotel_platform_admin_token"'), "Admin token contract changed");
  assert(adminJs.includes("/admin/login-branding"), "Admin branding API missing");
  assert(adminJs.includes("URL.createObjectURL"), "Local upload preview missing");
  assert(adminJs.includes('accept=".png,.jpg,.jpeg,.webp'), "Safe upload accept list missing");
  assert(adminJs.includes("data-branding-device"), "Preview device controls missing");
  assert(adminCss.includes('[data-device="tablet"]') && adminCss.includes('[data-device="mobile"]'), "Admin responsive preview CSS missing");
}

function verifyMigration() {
  for (const token of [
    "create table if not exists public.login_page_branding",
    "create table if not exists public.login_page_branding_audit",
    "login_page_branding_platform_singleton_idx",
    "login_page_branding_hotel_scope_idx",
    "login_page_branding_public_lookup_idx",
    "draft_config jsonb",
    "published_config jsonb",
    "is_published boolean",
    "version integer",
    "revoke all on public.login_page_branding from anon, authenticated",
    "grant usage, select on sequence public.login_page_branding_id_seq"
  ]) {
    assert(migration.includes(token), `Migration contract missing: ${token}`);
  }
  assert(rollback.indexOf("drop table if exists public.login_page_branding_audit") < rollback.indexOf("drop table if exists public.login_page_branding;"), "Rollback dependency order is unsafe");
}

verifyAuthenticationContract();
verifyBackendIntegration();
verifyValidationAndPublicShape();
verifyImageInspection();
verifyFrontendBranding();
verifyAdminEditor();
verifyMigration();

console.log("Login Page Branding verification passed.");
console.log("Verified authentication preservation, route mounting, public fallback precedence, Admin authorization, validation, image inspection, responsive UI, Admin preview, migration, and rollback contracts.");
