"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const { buildRoomCheckoutSummary } = require("../utils/room-checkout-summary");

const backendRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function verifyCheckoutTotals() {
  const summary = buildRoomCheckoutSummary({
    booking: {
      id: "booking-a",
      room_id: "room-a",
      guest_name: "Test Guest",
      total_amount: 1000,
      advance_paid: 300,
      room_price: 900,
      tax_amount: 100,
      discount_amount: 0
    },
    room: { room_number: "204" },
    foodOrders: [
      {
        id: "charge-unpaid",
        status: "preparing",
        payment_status: "unpaid",
        room_service_charge_to_room: true,
        totals: { final: 120.25 }
      },
      {
        id: "charge-paid",
        status: "served",
        payment_status: "paid",
        room_service_charge_to_room: true,
        totals: { total: 50 }
      },
      {
        id: "charge-refunded",
        status: "served",
        payment_status: "refunded",
        room_service_charge_to_room: true,
        totals: { normalTotal: 20 }
      },
      {
        id: "cancelled",
        status: "cancelled",
        payment_status: "unpaid",
        room_service_charge_to_room: true,
        totals: { total: 999 }
      },
      {
        id: "separate-unpaid",
        status: "served",
        payment_status: "unpaid",
        room_service_charge_to_room: false,
        items: [{ qty: 2, price: 30 }]
      },
      {
        id: "separate-paid",
        status: "served",
        payment_status: "paid",
        room_service_charge_to_room: false,
        totals: { total: 10 }
      }
    ]
  });

  assert.equal(summary.booking.roomNumber, "204");
  assert.equal(summary.roomCharges.balanceAmount, 700);
  assert.equal(summary.foodCharges.orderCount, 6);
  assert.equal(summary.foodCharges.billableOrderCount, 5);
  assert.equal(summary.foodCharges.chargeToRoomAmount, 190.25);
  assert.equal(summary.foodCharges.paidChargeToRoomAmount, 70);
  assert.equal(summary.foodCharges.outstandingChargeToRoomAmount, 120.25);
  assert.equal(summary.foodCharges.separateFoodAmount, 70);
  assert.equal(summary.foodCharges.separatePaidAmount, 10);
  assert.equal(summary.foodCharges.separateUnpaidAmount, 60);
  assert.equal(summary.totals.finalPayableAmount, 820.25);
}

function verifyStoredBalanceAndTotalPrecedence() {
  const summary = buildRoomCheckoutSummary({
    booking: {
      total_amount: 400,
      advance_paid: 100,
      balance_amount: -5
    },
    foodOrders: [
      {
        id: "total-precedence",
        status: "new",
        payment_status: "unpaid",
        room_service_charge_to_room: true,
        totals: { gpayFinalTotal: 80.555, final: 90, total: 100 }
      },
      {
        id: "failed-order",
        status: "payment_failed",
        payment_status: "unpaid",
        room_service_charge_to_room: true,
        totals: { total: 500 }
      }
    ]
  });

  assert.equal(summary.roomCharges.balanceAmount, 0);
  assert.equal(summary.foodCharges.billableOrderCount, 1);
  assert.equal(summary.foodCharges.outstandingChargeToRoomAmount, 80.56);
  assert.equal(summary.totals.finalPayableAmount, 80.56);
}

function verifyNullTotalFallback() {
  const summary = buildRoomCheckoutSummary({
    booking: { balance_amount: 0 },
    foodOrders: [
      {
        status: "new",
        payment_status: "unpaid",
        room_service_charge_to_room: true,
        totals: {
          gpayFinalTotal: null,
          final: "25.50"
        }
      }
    ]
  });

  assert.equal(summary.foodCharges.outstandingChargeToRoomAmount, 25.5);
  assert.equal(summary.totals.finalPayableAmount, 25.5);
}

function getRouteSection(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing route marker: ${startMarker}`);
  const end = source.indexOf("router.post(", start);
  assert.notEqual(end, -1, `Missing route boundary after: ${startMarker}`);
  return source.slice(start, end);
}

function verifyRouteTenantGuards() {
  const adminSource = readSource(path.join("routes", "admin-room-booking.js"));
  const staffSource = readSource(path.join("routes", "staff-room-booking.js"));
  const sharedImportPattern = /const\s*\{\s*buildRoomCheckoutSummary,\s*getNumberValue,\s*roundMoney\s*\}\s*=\s*require\("\.\.\/utils\/room-checkout-summary"\);/;

  assert.match(adminSource, sharedImportPattern);
  assert.match(staffSource, sharedImportPattern);
  assert.doesNotMatch(adminSource, /function\s+buildRoomCheckoutSummary\s*\(/);
  assert.doesNotMatch(staffSource, /function\s+buildRoomCheckoutSummary\s*\(/);

  const adminRoute = getRouteSection(
    adminSource,
    'router.get("/bookings/:id/checkout-summary"'
  );
  const staffRoute = getRouteSection(
    staffSource,
    '  "/bookings/:id/checkout-summary"'
  );

  assert.match(adminRoute, /fetchBookingForAdmin\(\{\s*bookingId,\s*hotelSlug\s*\}\)/);
  assert.equal(
    (adminRoute.match(/\.eq\("hotel_slug",\s*booking\.hotel_slug\)/g) || []).length,
    2
  );
  assert.match(staffRoute, /const\s+hotelSlug\s*=\s*normalizeText\(req\.staffHotelSlug,\s*120\)/);
  assert.match(staffRoute, /requireStaffManagerAccess/);
  assert.equal(
    (staffRoute.match(/\.eq\("hotel_slug",\s*hotelSlug\)/g) || []).length,
    2
  );
}

function main() {
  verifyCheckoutTotals();
  verifyStoredBalanceAndTotalPrecedence();
  verifyNullTotalFallback();
  verifyRouteTenantGuards();
  console.log("Room checkout summary verification passed.");
  console.log("Verified combined totals, non-billable exclusions, paid handling, rounding, and tenant-scoped route guards.");
  console.log("No database or network access was used.");
}

main();