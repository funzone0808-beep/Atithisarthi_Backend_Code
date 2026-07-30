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

function assertBuilderContract(source, functionName, endpointBase, safeAmountFunction, idempotencyFunction) {
  const body = sliceFunction(source, functionName);

  assert.match(body, new RegExp(`\\$\\{${endpointBase}\\}/room-booking/bookings/`));
  assert.match(body, /encodeURIComponent\(bookingId\)/);
  assert.match(body, /\/combined-checkout/);
  assert.match(body, new RegExp(`amount:\\s*${safeAmountFunction}\\(totals\\.finalPayableAmount\\)`));
  assert.match(body, /paymentMethod,/);
  assert.match(body, /transactionId:/);
  assert.match(body, /notes:/);
  assert.match(body, /currency:/);
  assert.match(body, /idempotencyKey:/);
  assert.match(body, new RegExp(`${idempotencyFunction}\\("(?:admin|staff)", bookingId\\)`));
  assert.doesNotMatch(body, /hotelSlug|hotel_slug|paymentStatus|payment_status|createdByRole|created_by_role/);
  assert.doesNotMatch(body, /fetchJson\(|staffFetchJson\(|fetch\(/);
}

function assertPostHelperContract(source, functionName, fetchFunction, enabledFunction, builderFunction) {
  const body = sliceFunction(source, functionName);

  assert.match(body, new RegExp(`if \\(!${enabledFunction}\\(\\)\\)`));
  assert.match(body, new RegExp(`const request = ${builderFunction}\\(summary, options\\);`));
  assert.match(body, new RegExp(`return ${fetchFunction}\\(request\\.endpoint, \\{`));
  assert.match(body, /method:\s*"POST"/);
  assert.match(body, /"Content-Type":\s*"application\/json"/);
  assert.match(body, /body:\s*JSON\.stringify\(request\.payload\)/);
}

function assertConfirmedClickHandlerContract(source, options = {}) {
  const body = sliceFunction(source, options.functionName);

  assert.match(body, new RegExp(`if \\(!${options.enabledFunction}\\(\\)\\)`));
  assert.match(body, new RegExp(`request = ${options.builderFunction}\\(summary, \\{ bookingId \\}\\)`));
  assert.match(body, /window\.confirm\(/);
  assert.match(body, /idempotencyKey:\s*request\.payload\.idempotencyKey/);
  assert.match(body, new RegExp(`await ${options.postHelperFunction}\\(summary, \\{`));
  assert.match(body, new RegExp(`await ${options.refreshFunction}\\(\\)`));
}

function main() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const adminJs = fs.readFileSync(path.join(projectRoot, "frontend", "js", "admin.js"), "utf8");
  const staffJs = fs.readFileSync(path.join(projectRoot, "frontend", "js", "staff-orders.js"), "utf8");
  const packageJson = fs.readFileSync(path.join(projectRoot, "backend", "package.json"), "utf8");

  assert.match(adminJs, /function buildAdminRoomCombinedCheckoutRequest\(summary = \{\}, options = \{\}\)/);
  assert.match(staffJs, /function buildStaffRoomCombinedCheckoutRequest\(summary = \{\}, options = \{\}\)/);
  assert.match(adminJs, /async function handleAdminRoomCombinedCheckoutButton\(button\)/);
  assert.match(staffJs, /async function handleStaffRoomCombinedCheckoutButton\(button\)/);
  assert.match(adminJs, /async function postAdminRoomCombinedCheckout\(summary = \{\}, options = \{\}\)/);
  assert.match(staffJs, /async function postStaffRoomCombinedCheckout\(summary = \{\}, options = \{\}\)/);
  assert.match(adminJs, /function getRoomCombinedCheckoutSafeAmount\(value\)/);
  assert.match(staffJs, /function getStaffRoomCombinedCheckoutSafeAmount\(value\)/);
  assert.match(adminJs, /function buildRoomCombinedCheckoutIdempotencyKey\(scope = "admin", bookingId = ""\)/);
  assert.match(staffJs, /function buildStaffRoomCombinedCheckoutIdempotencyKey\(scope = "staff", bookingId = ""\)/);

  assertBuilderContract(
    adminJs,
    "buildAdminRoomCombinedCheckoutRequest",
    "API_BASE",
    "getRoomCombinedCheckoutSafeAmount",
    "buildRoomCombinedCheckoutIdempotencyKey"
  );
  assertBuilderContract(
    staffJs,
    "buildStaffRoomCombinedCheckoutRequest",
    "STAFF_API_BASE",
    "getStaffRoomCombinedCheckoutSafeAmount",
    "buildStaffRoomCombinedCheckoutIdempotencyKey"
  );
  assertPostHelperContract(
    adminJs,
    "postAdminRoomCombinedCheckout",
    "fetchJson",
    "isRoomCombinedCheckoutFrontendEnabled",
    "buildAdminRoomCombinedCheckoutRequest"
  );
  assertPostHelperContract(
    staffJs,
    "postStaffRoomCombinedCheckout",
    "staffFetchJson",
    "isStaffRoomCombinedCheckoutFrontendEnabled",
    "buildStaffRoomCombinedCheckoutRequest"
  );
  assertConfirmedClickHandlerContract(adminJs, {
    functionName: "handleAdminRoomCombinedCheckoutButton",
    enabledFunction: "isRoomCombinedCheckoutFrontendEnabled",
    builderFunction: "buildAdminRoomCombinedCheckoutRequest",
    postHelperFunction: "postAdminRoomCombinedCheckout",
    refreshFunction: "loadTabData"
  });
  assertConfirmedClickHandlerContract(staffJs, {
    functionName: "handleStaffRoomCombinedCheckoutButton",
    enabledFunction: "isStaffRoomCombinedCheckoutFrontendEnabled",
    builderFunction: "buildStaffRoomCombinedCheckoutRequest",
    postHelperFunction: "postStaffRoomCombinedCheckout",
    refreshFunction: "loadStaffRooms"
  });

  assert.match(
    packageJson,
    /"verify:room-checkout-frontend-payload":\s*"node scripts\/verify-room-combined-checkout-frontend-payload\.js"/
  );

  console.log("Combined checkout frontend payload verification passed.");
  console.log("Verified admin/staff guarded request builders, confirmed staging settlement handlers, backend-summary amount source, and idempotency reuse.");
}

main();