"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

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

function main() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const adminJs = fs.readFileSync(
    path.join(projectRoot, "frontend", "js", "admin.js"),
    "utf8"
  );
  const appConfigJs = fs.readFileSync(
    path.join(projectRoot, "frontend", "js", "app-config.js"),
    "utf8"
  );
  const handler = sliceFunction(adminJs, "handleAdminRoomCombinedCheckoutButton");
  const postHelper = sliceFunction(adminJs, "postAdminRoomCombinedCheckout");

  assert.match(appConfigJs, /metaRoomCombinedCheckoutFrontendEnabled/);
  assert.match(appConfigJs, /"app-room-combined-checkout-frontend-enabled"/);
  assert.match(
    appConfigJs,
    /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED:[\s\S]*cleanBoolean\(metaRoomCombinedCheckoutFrontendEnabled, false\)/
  );
  assert.match(adminJs, /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED === true/);
  assert.match(adminJs, /function getRoomCombinedCheckoutDisabledAttribute\(\)/);
  assert.match(adminJs, /return isRoomCombinedCheckoutFrontendEnabled\(\) \? "" : "disabled";/);
  assert.match(adminJs, /data-print-room-checkout-summary/);
  assert.match(adminJs, /data-finalize-room-combined-checkout/);
  assert.match(adminJs, /async function handleAdminRoomCombinedCheckoutButton\(button\)/);
  assert.match(adminJs, /async function postAdminRoomCombinedCheckout\(summary = \{\}, options = \{\}\)/);
  assert.match(handler, /if \(!isRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(handler, /request = buildAdminRoomCombinedCheckoutRequest\(summary, \{ bookingId \}\)/);
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /idempotencyKey:\s*request\.payload\.idempotencyKey/);
  assert.match(handler, /await postAdminRoomCombinedCheckout\(summary, \{/);
  assert.match(handler, /await loadTabData\(\)/);
  assert.match(postHelper, /if \(!isRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(postHelper, /return fetchJson\(request\.endpoint, \{/);
  assert.match(postHelper, /method:\s*"POST"/);
  assert.match(
    adminJs,
    /data-finalize-room-combined-checkout[\s\S]*?\$\{getRoomCombinedCheckoutDisabledAttribute\(\)\}[\s\S]*?>Finalize Combined Checkout<\/button>/
  );
  assert.match(
    adminJs,
    /Combined checkout stays disabled until the backend migration, staging verifier, and feature flag are enabled\./
  );

  console.log("Admin combined checkout UI guard verification passed.");
  console.log("Verified default-off frontend flag, confirmed admin settlement handler, idempotency reuse, and guarded POST helper.");
}

main();