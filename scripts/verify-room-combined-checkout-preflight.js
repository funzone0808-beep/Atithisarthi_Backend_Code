"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const backendRoot = path.join(projectRoot, "backend");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function sliceFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`) !== -1
    ? source.indexOf(`function ${functionName}`)
    : source.indexOf(`async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);

  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextAsyncFunction = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextFunction, nextAsyncFunction].filter((index) => index !== -1);
  const nextBoundary = candidates.length ? Math.min(...candidates) : -1;
  return nextBoundary === -1 ? source.slice(start) : source.slice(start, nextBoundary);
}

function assertDefaultOffEnvironment() {
  [
    path.join("backend", ".env.example"),
    path.join("backend", ".env.production.example"),
    path.join("backend", ".env.first-client.cloudflare-railway.example")
  ].forEach((relativePath) => {
    const source = read(relativePath);
    assert.match(
      source,
      /^ROOM_COMBINED_CHECKOUT_ENABLED=false$/m,
      `${relativePath} must keep combined checkout default-off`
    );
    assert.match(
      source,
      /^APP_ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=false$/m,
      `${relativePath} must keep frontend combined checkout default-off`
    );
  });
}

function assertRoutesAreGuarded() {
  const adminRoute = read(path.join("backend", "routes", "admin-room-booking.js"));
  const staffRoute = read(path.join("backend", "routes", "staff-room-booking.js"));

  assert.match(adminRoute, /isEnabled:\s*\(\)\s*=>\s*env\.roomCombinedCheckoutEnabled/);
  assert.match(staffRoute, /isEnabled:\s*\(\)\s*=>\s*env\.roomCombinedCheckoutEnabled/);
  assert.match(
    adminRoute,
    /"\/bookings\/:id\/combined-checkout",\s*requireAdminCombinedBilling,\s*requireRoomCombinedCheckoutEnabled,\s*validateBody\(roomCombinedCheckoutSchema\),\s*adminRoomCombinedCheckoutHandler/m
  );
  assert.match(
    staffRoute,
    /"\/bookings\/:id\/combined-checkout",\s*requireStaffManagerAccess,\s*requireStaffCombinedBilling,\s*requireRoomCombinedCheckoutEnabled,\s*validateBody\(roomCombinedCheckoutSchema\),\s*staffRoomCombinedCheckoutHandler/m
  );
  assert.doesNotMatch(adminRoute, /\.rpc\(\s*["']settle_room_combined_checkout["']/);
  assert.doesNotMatch(staffRoute, /\.rpc\(\s*["']settle_room_combined_checkout["']/);
}

function assertFrontendIsDormant() {
  const appConfigJs = read(path.join("frontend", "js", "app-config.js"));
  const adminJs = read(path.join("frontend", "js", "admin.js"));
  const staffJs = read(path.join("frontend", "js", "staff-orders.js"));
  const prepareRuntimeConfigJs = read(path.join("backend", "scripts", "prepare-frontend-runtime-config.js"));
  const resetRuntimeConfigJs = read(path.join("backend", "scripts", "reset-frontend-runtime-config.js"));
  const verifyRuntimeConfigJs = read(path.join("backend", "scripts", "verify-frontend-runtime-config.js"));
  const verifyNeutralRuntimeConfigJs = read(path.join("backend", "scripts", "verify-frontend-runtime-config-neutral.js"));
  const frontendPages = [
    "index.html",
    "menu.html",
    "admin.html",
    "staff-orders.html",
    "order-tracking.html"
  ];
  const adminHandler = sliceFunction(adminJs, "handleAdminRoomCombinedCheckoutButton");
  const staffHandler = sliceFunction(staffJs, "handleStaffRoomCombinedCheckoutButton");
  const adminPostHelper = sliceFunction(adminJs, "postAdminRoomCombinedCheckout");
  const staffPostHelper = sliceFunction(staffJs, "postStaffRoomCombinedCheckout");

  assert.match(appConfigJs, /metaRoomCombinedCheckoutFrontendEnabled/);
  assert.match(appConfigJs, /"app-room-combined-checkout-frontend-enabled"/);
  assert.match(appConfigJs, /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED:\s*cleanBoolean\([\s\S]*?cleanBoolean\(metaRoomCombinedCheckoutFrontendEnabled, false\)/);
  assert.match(prepareRuntimeConfigJs, /APP_ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED/);
  assert.match(prepareRuntimeConfigJs, /"app-room-combined-checkout-frontend-enabled"/);
  assert.match(resetRuntimeConfigJs, /"app-room-combined-checkout-frontend-enabled"[\s\S]*?"false"/);
  assert.match(verifyRuntimeConfigJs, /APP_ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED/);
  assert.match(verifyNeutralRuntimeConfigJs, /app-room-combined-checkout-frontend-enabled should be false in the neutral repo state/);
  frontendPages.forEach((pageName) => {
    assert.match(
      read(path.join("frontend", pageName)),
      /<meta name="app-room-combined-checkout-frontend-enabled" content="false" \/>/,
      `${pageName} must include the default-off frontend combined checkout meta tag`
    );
  });
  assert.match(adminJs, /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED === true/);
  assert.match(staffJs, /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED === true/);
  assert.match(
    adminJs,
    /data-finalize-room-combined-checkout[\s\S]*?\$\{getRoomCombinedCheckoutDisabledAttribute\(\)\}[\s\S]*?>Finalize Combined Checkout<\/button>/
  );
  assert.match(
    staffJs,
    /data-staff-finalize-room-combined-checkout[\s\S]*?\$\{getStaffRoomCombinedCheckoutDisabledAttribute\(\)\}[\s\S]*?>Finalize Combined Checkout<\/button>/
  );
  assert.match(adminPostHelper, /if \(!isRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(adminPostHelper, /return fetchJson\(request\.endpoint, \{/);
  assert.match(staffPostHelper, /if \(!isStaffRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(staffPostHelper, /return staffFetchJson\(request\.endpoint, \{/);
  assert.match(adminHandler, /if \(!isRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(adminHandler, /window\.confirm\(/);
  assert.match(adminHandler, /await postAdminRoomCombinedCheckout\(summary, \{/);
  assert.match(adminHandler, /idempotencyKey:\s*request\.payload\.idempotencyKey/);
  assert.match(staffHandler, /if \(!isStaffRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(staffHandler, /window\.confirm\(/);
  assert.match(staffHandler, /await postStaffRoomCombinedCheckout\(summary, \{/);
  assert.match(staffHandler, /idempotencyKey:\s*request\.payload\.idempotencyKey/);
}

function assertPreflightScriptsAreRegistered() {
  const packageJson = read(path.join("backend", "package.json"));
  assert.match(packageJson, /"verify:room-checkout-flag":\s*"node scripts\/verify-room-combined-checkout-flag\.js"/);
  assert.match(packageJson, /"verify:room-checkout-admin-ui":\s*"node scripts\/verify-room-combined-checkout-admin-ui\.js"/);
  assert.match(packageJson, /"verify:room-checkout-staff-ui":\s*"node scripts\/verify-room-combined-checkout-staff-ui\.js"/);
  assert.match(packageJson, /"verify:room-checkout-preflight":\s*"node scripts\/verify-room-combined-checkout-preflight\.js"/);
}

function main() {
  assert.ok(fs.existsSync(backendRoot), "backend directory must exist");
  assertDefaultOffEnvironment();
  assertRoutesAreGuarded();
  assertFrontendIsDormant();
  assertPreflightScriptsAreRegistered();

  console.log("Combined checkout preflight verification passed.");
  console.log("Verified default-off backend/frontend config, guarded routes, runtime flag stamping, confirmed staging handlers, and guarded POST helpers.");
}

main();
