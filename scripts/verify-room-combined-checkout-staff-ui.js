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
  const staffJs = fs.readFileSync(
    path.join(projectRoot, "frontend", "js", "staff-orders.js"),
    "utf8"
  );
  const appConfigJs = fs.readFileSync(
    path.join(projectRoot, "frontend", "js", "app-config.js"),
    "utf8"
  );
  const handler = sliceFunction(staffJs, "handleStaffRoomCombinedCheckoutButton");
  const postHelper = sliceFunction(staffJs, "postStaffRoomCombinedCheckout");

  assert.match(appConfigJs, /metaRoomCombinedCheckoutFrontendEnabled/);
  assert.match(appConfigJs, /"app-room-combined-checkout-frontend-enabled"/);
  assert.match(
    appConfigJs,
    /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED:[\s\S]*cleanBoolean\(metaRoomCombinedCheckoutFrontendEnabled, false\)/
  );
  assert.match(staffJs, /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED === true/);
  assert.match(staffJs, /function getStaffRoomCombinedCheckoutDisabledAttribute\(\)/);
  assert.match(staffJs, /return isStaffRoomCombinedCheckoutFrontendEnabled\(\) \? "" : "disabled";/);
  assert.match(staffJs, /data-staff-room-checkout-print/);
  assert.match(staffJs, /data-staff-finalize-room-combined-checkout/);
  assert.match(staffJs, /async function handleStaffRoomCombinedCheckoutButton\(button\)/);
  assert.match(staffJs, /async function postStaffRoomCombinedCheckout\(summary = \{\}, options = \{\}\)/);
  assert.match(handler, /if \(!isStaffRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(handler, /request = buildStaffRoomCombinedCheckoutRequest\(summary, \{ bookingId \}\)/);
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /idempotencyKey:\s*request\.payload\.idempotencyKey/);
  assert.match(handler, /await postStaffRoomCombinedCheckout\(summary, \{/);
  assert.match(handler, /await loadStaffRooms\(\)/);
  assert.match(postHelper, /if \(!isStaffRoomCombinedCheckoutFrontendEnabled\(\)\)/);
  assert.match(postHelper, /return staffFetchJson\(request\.endpoint, \{/);
  assert.match(postHelper, /method:\s*"POST"/);
  assert.match(
    staffJs,
    /data-staff-finalize-room-combined-checkout[\s\S]*?\$\{getStaffRoomCombinedCheckoutDisabledAttribute\(\)\}[\s\S]*?>Finalize Combined Checkout<\/button>/
  );
  assert.match(
    staffJs,
    /Combined checkout stays disabled until the backend migration, staging verifier, and feature flag are enabled\./
  );

  console.log("Staff combined checkout UI guard verification passed.");
  console.log("Verified default-off frontend flag, confirmed staff settlement handler, idempotency reuse, and guarded POST helper.");
}

main();