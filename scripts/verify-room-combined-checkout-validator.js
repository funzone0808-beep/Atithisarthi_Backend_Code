"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const { roomCombinedCheckoutSchema } = require("../validators/rooms");

function expectInvalid(payload, label) {
  const result = roomCombinedCheckoutSchema.safeParse(payload);
  assert.equal(result.success, false, `${label} should be rejected`);
}

function main() {
  const validResult = roomCombinedCheckoutSchema.safeParse({
    amount: 0,
    paymentMethod: " cash ",
    transactionId: null,
    notes: " Final checkout ",
    idempotencyKey: "checkout:booking-42:attempt-1",
    currency: "inr"
  });

  assert.equal(validResult.success, true);
  assert.equal(validResult.data.amount, 0);
  assert.equal(validResult.data.paymentMethod, "cash");
  assert.equal(validResult.data.notes, "Final checkout");
  assert.equal(validResult.data.currency, "INR");

  expectInvalid({ amount: -1, paymentMethod: "cash", idempotencyKey: "checkout-1" }, "negative amount");
  expectInvalid({ amount: Number.NaN, paymentMethod: "cash", idempotencyKey: "checkout-2" }, "non-finite amount");
  expectInvalid({ amount: 10, paymentMethod: "", idempotencyKey: "checkout-3" }, "empty payment method");
  expectInvalid({ amount: 10, paymentMethod: "cash", idempotencyKey: "short" }, "short idempotency key");
  expectInvalid({ amount: 10, paymentMethod: "cash", idempotencyKey: "checkout key with spaces" }, "unsafe idempotency key");
  expectInvalid({ amount: 10, paymentMethod: "cash", idempotencyKey: "checkout-4", currency: "12" }, "invalid currency");
  expectInvalid({ amount: 10, paymentMethod: "cash", idempotencyKey: "checkout-5", hotelSlug: "another-hotel" }, "frontend tenant scope");
  expectInvalid({ amount: 10, paymentMethod: "cash", idempotencyKey: "checkout-6", paymentStatus: "paid" }, "frontend payment status");
  expectInvalid({ amount: 10, paymentMethod: "cash", idempotencyKey: "checkout-7", createdByRole: "admin" }, "frontend creator role");

  const backendRoot = path.resolve(__dirname, "..");
  const adminRoute = fs.readFileSync(path.join(backendRoot, "routes", "admin-room-booking.js"), "utf8");
  const staffRoute = fs.readFileSync(path.join(backendRoot, "routes", "staff-room-booking.js"), "utf8");

  assert.match(adminRoute, /validateBody\(roomCombinedCheckoutSchema\)/);
  assert.match(staffRoute, /validateBody\(roomCombinedCheckoutSchema\)/);

  console.log("Combined checkout validator verification passed.");
  console.log("Verified zero-balance checkout, normalization, idempotency, and rejection of tenant/payment-state tampering.");
  console.log("Verified admin and staff apply strict body validation.");
}

main();