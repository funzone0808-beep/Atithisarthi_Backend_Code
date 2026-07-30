"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assertIncludes(source, text, label) {
  assert.ok(source.includes(text), `${label} must include ${text}`);
}

function assertRouteOrder(source, pattern, label) {
  assert.ok(pattern.test(source), `${label} route middleware order is not protected as expected`);
}

function main() {
  const staffMiddleware = read("backend/middleware/require-staff-auth.js");
  const staffRoute = read("backend/routes/staff-room-booking.js");
  const staffFrontend = read("frontend/js/staff-orders.js");
  const packageJson = read("backend/package.json");

  assertIncludes(staffMiddleware, "function requireStaffManagerAccess", "staff manager middleware");
  assertIncludes(staffMiddleware, 'code: "manager_access_required"', "staff manager middleware");
  assertIncludes(staffMiddleware, "Manager access is required for this staff section", "staff manager middleware");

  assertRouteOrder(
    staffRoute,
    /router\.post\(\s*"\/bookings",\s*validateBody\(staffRoomBookingCreateSchema\),\s*async/m,
    "staff manual room booking create"
  );
  assertRouteOrder(
    staffRoute,
    /router\.patch\(\s*"\/bookings\/:id\/status",\s*requireStaffManagerAccess,\s*validateBody\(adminRoomBookingStatusUpdateSchema\)/m,
    "staff room booking status update"
  );
  assertRouteOrder(
    staffRoute,
    /router\.get\(\s*"\/bookings\/:id\/checkout-summary",\s*requireStaffManagerAccess,\s*async/m,
    "staff room checkout summary"
  );
  assertRouteOrder(
    staffRoute,
    /router\.post\(\s*"\/bookings\/:id\/combined-checkout",\s*requireStaffManagerAccess,\s*requireStaffCombinedBilling,\s*requireRoomCombinedCheckoutEnabled,\s*validateBody\(roomCombinedCheckoutSchema\),\s*staffRoomCombinedCheckoutHandler/m,
    "staff room combined checkout"
  );
  assertRouteOrder(
    staffRoute,
    /router\.post\(\s*"\/bookings\/:id\/payments",\s*requireStaffManagerAccess,\s*validateBody\(adminRoomBookingPaymentSchema\)/m,
    "staff room booking payment"
  );

  assertIncludes(staffFrontend, "function isStaffManagerSession", "staff frontend role helper");
  assertIncludes(staffFrontend, "const canUpdateStatus = isStaffManagerSession();", "staff room booking card");
  assertIncludes(staffFrontend, '${canUpdateStatus ? buildStaffRoomBookingStatusControls(booking) : ""}', "staff status controls gate");
  assertIncludes(staffFrontend, '${canUpdateStatus && hasFinancialFields ? buildStaffRoomBookingPaymentControls(booking) : ""}', "staff payment controls gate");
  assertIncludes(staffFrontend, '${canUpdateStatus && hasFinancialFields ? buildStaffRoomCheckoutSummaryControls(booking) : ""}', "staff checkout controls gate");
  assertIncludes(staffFrontend, 'error.code = data.code || "";', "staff fetch permission code preservation");

  assert.match(
    packageJson,
    /"verify:room-booking-permissions":\s*"node scripts\/verify-room-booking-action-permissions\.js"/,
    "package.json must expose the room booking permissions verifier"
  );

  console.log("Room booking action permission verification passed.");
  console.log("Verified normal staff can create manual bookings, while status, checkout summary, combined checkout, and room payment actions stay manager-only.");
}

main();
