"use strict";

const CHECKOUT_RPC_NAME = "settle_room_combined_checkout";
const SCHEMA_ERROR_CODES = new Set([
  "42P01",
  "42703",
  "42883",
  "PGRST202",
  "PGRST204",
  "PGRST205"
]);

function normalizeRequiredText(value, label, maxLength) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new TypeError(`${label} is required`);
  }

  if (normalized.length > maxLength) {
    throw new TypeError(`${label} is too long`);
  }

  return normalized;
}

function normalizeOptionalText(value, maxLength) {
  const normalized = String(value || "").trim();

  if (normalized.length > maxLength) {
    throw new TypeError("Optional checkout value is too long");
  }

  return normalized || null;
}

function normalizeBookingId(value) {
  const normalized = String(value || "").trim();

  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new TypeError("Booking id must be a positive integer");
  }

  return normalized;
}

function normalizeAmount(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 99999999.99
  ) {
    throw new TypeError("Checkout amount is invalid");
  }

  return Math.round(value * 100) / 100;
}

function normalizeIdempotencyKey(value) {
  const normalized = normalizeRequiredText(value, "Idempotency key", 200);

  if (
    normalized.length < 8 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new TypeError("Idempotency key is invalid");
  }

  return normalized;
}

function buildCombinedCheckoutRpcParams({
  hotelSlug,
  bookingId,
  amount,
  paymentMethod,
  transactionId = null,
  notes = "",
  idempotencyKey,
  currency = "INR",
  actorUserId = null,
  actorRole = null
} = {}) {
  const normalizedCurrency = normalizeRequiredText(currency, "Currency", 8).toUpperCase();

  if (!/^[A-Z]{3,8}$/.test(normalizedCurrency)) {
    throw new TypeError("Currency is invalid");
  }

  return {
    p_hotel_slug: normalizeRequiredText(hotelSlug, "Hotel scope", 120),
    p_booking_id: normalizeBookingId(bookingId),
    p_amount: normalizeAmount(amount),
    p_payment_method: normalizeRequiredText(paymentMethod, "Payment method", 80),
    p_transaction_id: normalizeOptionalText(transactionId, 200),
    p_notes: normalizeOptionalText(notes, 2000) || "",
    p_created_by_user_id: normalizeOptionalText(actorUserId, 200),
    p_created_by_role: normalizeOptionalText(actorRole, 80),
    p_idempotency_key: normalizeIdempotencyKey(idempotencyKey),
    p_currency: normalizedCurrency
  };
}

function mapCombinedCheckoutRpcError(error = {}) {
  const code = String(error.code || "").trim().toUpperCase();
  const message = String(error.message || "").trim();
  const normalizedMessage = message.toLowerCase();

  if (
    SCHEMA_ERROR_CODES.has(code) ||
    (normalizedMessage.includes(CHECKOUT_RPC_NAME) && normalizedMessage.includes("not found"))
  ) {
    return {
      ok: false,
      status: 503,
      schemaReady: false,
      code: "checkout_schema_unavailable",
      message: "Combined checkout schema is not initialized yet"
    };
  }

  if (normalizedMessage.includes("checkout amount does not match backend total")) {
    return {
      ok: false,
      status: 409,
      schemaReady: true,
      code: "checkout_total_changed",
      message: "Checkout total changed. Reload the checkout summary and try again."
    };
  }

  if (code === "P0002") {
    return {
      ok: false,
      status: 404,
      schemaReady: true,
      code: "booking_not_found",
      message: "Room booking was not found for this hotel"
    };
  }

  if (code === "40001" || normalizedMessage.includes("orders changed during checkout")) {
    return {
      ok: false,
      status: 409,
      schemaReady: true,
      retryable: true,
      code: "checkout_conflict",
      message: "Room service orders changed during checkout. Reload and try again."
    };
  }

  if (
    code === "23505" ||
    code === "23514" ||
    normalizedMessage.includes("checked-in bookings")
  ) {
    return {
      ok: false,
      status: 409,
      schemaReady: true,
      code: "checkout_state_conflict",
      message: "Booking state does not allow combined checkout"
    };
  }

  return {
    ok: false,
    status: 500,
    schemaReady: true,
    code: "checkout_failed",
    message: "Combined checkout failed"
  };
}

async function settleRoomCombinedCheckout({ supabaseClient, ...checkoutContext } = {}) {
  if (!supabaseClient || typeof supabaseClient.rpc !== "function") {
    throw new TypeError("Supabase client with rpc() is required");
  }

  const params = buildCombinedCheckoutRpcParams(checkoutContext);
  const { data, error } = await supabaseClient.rpc(CHECKOUT_RPC_NAME, params);

  if (error) {
    return mapCombinedCheckoutRpcError(error);
  }

  if (
    !data ||
    typeof data !== "object" ||
    !data.receipt ||
    typeof data.receipt !== "object" ||
    !data.booking ||
    typeof data.booking !== "object"
  ) {
    return {
      ok: false,
      status: 502,
      schemaReady: true,
      code: "checkout_response_invalid",
      message: "Combined checkout returned an invalid response"
    };
  }

  const settledOrderCount = Number(data.settledOrderCount || 0);

  return {
    ok: true,
    status: 200,
    schemaReady: true,
    idempotentReplay: data.idempotentReplay === true,
    receipt: data.receipt,
    booking: data.booking,
    settledOrderCount: Number.isFinite(settledOrderCount)
      ? Math.max(0, Math.trunc(settledOrderCount))
      : 0
  };
}

module.exports = {
  CHECKOUT_RPC_NAME,
  buildCombinedCheckoutRpcParams,
  mapCombinedCheckoutRpcError,
  settleRoomCombinedCheckout
};