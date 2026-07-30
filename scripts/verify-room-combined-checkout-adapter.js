"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const {
  CHECKOUT_RPC_NAME,
  buildCombinedCheckoutRpcParams,
  settleRoomCombinedCheckout
} = require("../utils/room-combined-checkout");

function createFakeClient(result) {
  const calls = [];

  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      return result;
    }
  };
}

async function main() {
  const params = buildCombinedCheckoutRpcParams({
    hotelSlug: " hotel-a ",
    bookingId: "42",
    amount: 125.456,
    paymentMethod: " cash ",
    transactionId: " txn-1 ",
    notes: " final payment ",
    idempotencyKey: "checkout:booking-42:attempt-1",
    currency: "inr",
    actorUserId: "staff-9",
    actorRole: "manager"
  });

  assert.deepEqual(params, {
    p_hotel_slug: "hotel-a",
    p_booking_id: "42",
    p_amount: 125.46,
    p_payment_method: "cash",
    p_transaction_id: "txn-1",
    p_notes: "final payment",
    p_created_by_user_id: "staff-9",
    p_created_by_role: "manager",
    p_idempotency_key: "checkout:booking-42:attempt-1",
    p_currency: "INR"
  });

  assert.throws(
    () => buildCombinedCheckoutRpcParams({
      hotelSlug: "",
      bookingId: "42",
      amount: 10,
      paymentMethod: "cash",
      idempotencyKey: "checkout-42"
    }),
    /Hotel scope is required/
  );
  assert.throws(
    () => buildCombinedCheckoutRpcParams({
      hotelSlug: "hotel-a",
      bookingId: "not-an-id",
      amount: 10,
      paymentMethod: "cash",
      idempotencyKey: "checkout-42"
    }),
    /Booking id/
  );
  assert.throws(
    () => buildCombinedCheckoutRpcParams({
      hotelSlug: "hotel-a",
      bookingId: "42",
      amount: null,
      paymentMethod: "cash",
      idempotencyKey: "checkout-42"
    }),
    /Checkout amount/
  );

  const successClient = createFakeClient({
    data: {
      idempotentReplay: false,
      receipt: { id: 7, amount: 125.46 },
      booking: { id: 42, booking_status: "checked_out" },
      settledOrderCount: 2
    },
    error: null
  });
  const success = await settleRoomCombinedCheckout({
    supabaseClient: successClient,
    hotelSlug: "hotel-a",
    bookingId: 42,
    amount: 125.46,
    paymentMethod: "cash",
    idempotencyKey: "checkout-42"
  });

  assert.equal(success.ok, true);
  assert.equal(success.settledOrderCount, 2);
  assert.equal(successClient.calls.length, 1);
  assert.equal(successClient.calls[0].name, CHECKOUT_RPC_NAME);
  assert.equal(successClient.calls[0].params.p_hotel_slug, "hotel-a");

  const errorCases = [
    {
      error: { code: "PGRST202", message: "Function not found" },
      expected: { status: 503, code: "checkout_schema_unavailable" }
    },
    {
      error: { code: "22023", message: "Checkout amount does not match backend total" },
      expected: { status: 409, code: "checkout_total_changed" }
    },
    {
      error: { code: "P0002", message: "Room booking not found for this hotel" },
      expected: { status: 404, code: "booking_not_found" }
    },
    {
      error: { code: "40001", message: "Room service orders changed during checkout" },
      expected: { status: 409, code: "checkout_conflict" }
    },
    {
      error: { code: "23514", message: "Only checked-in bookings can be checked out" },
      expected: { status: 409, code: "checkout_state_conflict" }
    }
  ];

  for (const testCase of errorCases) {
    const client = createFakeClient({ data: null, error: testCase.error });
    const result = await settleRoomCombinedCheckout({
      supabaseClient: client,
      hotelSlug: "hotel-a",
      bookingId: 42,
      amount: 10,
      paymentMethod: "cash",
      idempotencyKey: "checkout-42"
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, testCase.expected.status);
    assert.equal(result.code, testCase.expected.code);
  }

  const invalidResponseClient = createFakeClient({ data: {}, error: null });
  const invalidResponse = await settleRoomCombinedCheckout({
    supabaseClient: invalidResponseClient,
    hotelSlug: "hotel-a",
    bookingId: 42,
    amount: 0,
    paymentMethod: "cash",
    idempotencyKey: "checkout-42"
  });
  assert.equal(invalidResponse.status, 502);
  assert.equal(invalidResponse.code, "checkout_response_invalid");

  const backendRoot = path.resolve(__dirname, "..");
  const adminRoute = fs.readFileSync(path.join(backendRoot, "routes", "admin-room-booking.js"), "utf8");
  const staffRoute = fs.readFileSync(path.join(backendRoot, "routes", "staff-room-booking.js"), "utf8");
  assert.match(adminRoute, /room-combined-checkout-handler/);
  assert.match(staffRoute, /room-combined-checkout-handler/);

  console.log("Combined checkout RPC adapter verification passed.");
  console.log("Verified RPC parameter mapping, defensive validation, stable error mapping, and malformed-response handling.");
  console.log("Verified admin and staff use the guarded handler boundary.");
  console.log("No database or network access was used.");
}

main().catch((error) => {
  console.error(`Combined checkout RPC adapter verification failed: ${error.message}`);
  process.exit(1);
});