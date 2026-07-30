"use strict";

const crypto = require("crypto");

const DEFAULT_ROOM_ADVANCE_POLICY = Object.freeze({
  advanceMode: "optional",
  minimumType: "fixed",
  minimumValue: 0,
  allowZeroAdvance: true,
  allowMultiplePayments: true,
  allowSplitPayments: true,
  allowStaffAdvance: false,
  allowedPaymentMethods: Object.freeze(["cash", "upi", "card", "bank_transfer"]),
  currency: "INR",
  automaticCancellationEnabled: false,
  version: 1,
  schemaReady: false,
  recordExists: false
});

const ADVANCE_OPTIONS = new Set(["no_advance", "partial", "full", "split"]);
const PAYMENT_METHOD_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;

function roundMoney(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function normalizeMethod(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeText(value = "", maxLength = 500) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength)
    : "";
}

function normalizeRoomAdvancePolicy(row = null) {
  if (!row || typeof row !== "object") {
    return { ...DEFAULT_ROOM_ADVANCE_POLICY };
  }

  const configuredMethods = Array.isArray(row.allowed_payment_methods)
    ? row.allowed_payment_methods.map(normalizeMethod).filter((method) => PAYMENT_METHOD_PATTERN.test(method))
    : [];

  return {
    advanceMode: ["disabled", "optional", "required"].includes(row.advance_mode)
      ? row.advance_mode
      : DEFAULT_ROOM_ADVANCE_POLICY.advanceMode,
    minimumType: ["fixed", "percentage"].includes(row.minimum_type)
      ? row.minimum_type
      : DEFAULT_ROOM_ADVANCE_POLICY.minimumType,
    minimumValue: roundMoney(Math.max(0, Number(row.minimum_value || 0))),
    allowZeroAdvance: row.allow_zero_advance !== false,
    allowMultiplePayments: row.allow_multiple_payments !== false,
    allowSplitPayments: row.allow_split_payments !== false,
    allowStaffAdvance: row.allow_staff_advance === true,
    allowedPaymentMethods: configuredMethods.length
      ? configuredMethods
      : [...DEFAULT_ROOM_ADVANCE_POLICY.allowedPaymentMethods],
    currency: /^[A-Z]{3}$/.test(String(row.currency || "").trim().toUpperCase())
      ? String(row.currency).trim().toUpperCase()
      : DEFAULT_ROOM_ADVANCE_POLICY.currency,
    automaticCancellationEnabled: row.automatic_cancellation_enabled === true,
    version: Math.max(1, Number(row.version || 1)),
    schemaReady: true,
    recordExists: true
  };
}

function isMissingAdvanceSchemaError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .toLowerCase();
  return (
    ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code) ||
    details.includes("hotel_room_advance_policies") ||
    details.includes("create_room_booking_with_advance")
  );
}

async function fetchRoomAdvancePolicy({ supabaseClient, hotelSlug }) {
  const { data, error } = await supabaseClient
    .from("hotel_room_advance_policies")
    .select("*")
    .eq("hotel_slug", hotelSlug)
    .maybeSingle();

  if (error) {
    if (isMissingAdvanceSchemaError(error)) {
      return { ...DEFAULT_ROOM_ADVANCE_POLICY };
    }
    throw error;
  }

  if (!data) {
    return { ...DEFAULT_ROOM_ADVANCE_POLICY, schemaReady: true };
  }
  return normalizeRoomAdvancePolicy(data);
}

function getRequestedAdvanceOption(body = {}, totalAmount = 0) {
  const explicit = normalizeText(body.advanceOption, 40).toLowerCase();
  if (explicit) return explicit;

  const lines = Array.isArray(body.advancePayments) ? body.advancePayments : [];
  if (lines.length > 1) return "split";

  const legacyAmount = roundMoney(body.advanceAmount ?? body.advancePaid ?? lines[0]?.amount ?? 0);
  if (legacyAmount <= 0) return "no_advance";
  return legacyAmount >= roundMoney(totalAmount) ? "full" : "partial";
}

function getMinimumAdvance(policy, totalAmount) {
  if (policy.minimumType === "percentage") {
    return roundMoney((roundMoney(totalAmount) * policy.minimumValue) / 100);
  }
  return roundMoney(policy.minimumValue);
}

function makeAdvanceError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizePaymentLine(line = {}, fallbackMethod = "") {
  const method = normalizeMethod(line.paymentMethod || line.method || fallbackMethod);
  const transactionId = normalizeText(
    line.transactionId || line.providerReference || "",
    200
  );

  return {
    amount: roundMoney(line.amount),
    paymentMethod: method,
    transactionId,
    notes: normalizeText(line.notes || "", 1000)
  };
}

function buildRoomAdvancePlan({
  body = {},
  totalAmount = 0,
  policy = DEFAULT_ROOM_ADVANCE_POLICY,
  actorIsManager = false
} = {}) {
  const trustedTotal = roundMoney(Math.max(0, Number(totalAmount || 0)));
  const option = getRequestedAdvanceOption(body, trustedTotal);
  if (!ADVANCE_OPTIONS.has(option)) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_OPTION_INVALID",
      "Choose No Advance, Partial Advance, Full Advance, or Split Advance."
    );
  }

  let rawLines = Array.isArray(body.advancePayments) ? body.advancePayments : [];
  const fallbackMethod = body.paymentMethod || "";
  const requestedAmount = roundMoney(body.advanceAmount ?? body.advancePaid ?? 0);

  if (option === "no_advance") {
    const lineTotal = roundMoney(
      rawLines.reduce((sum, line) => sum + roundMoney(line?.amount), 0)
    );
    if (requestedAmount > 0 || lineTotal > 0) {
      throw makeAdvanceError(
        "ROOM_ADVANCE_OPTION_AMOUNT_CONFLICT",
        "No Advance cannot include a payment amount."
      );
    }
    if (policy.advanceMode === "required" && (!policy.allowZeroAdvance || getMinimumAdvance(policy, trustedTotal) > 0)) {
      throw makeAdvanceError(
        "ROOM_ADVANCE_REQUIRED",
        "An advance payment is required by this hotel's Room booking policy.",
        409
      );
    }
    return {
      option,
      totalAmount: 0,
      balanceAmount: trustedTotal,
      paymentStatus: "unpaid",
      currency: policy.currency,
      payments: []
    };
  }

  if (policy.advanceMode === "disabled") {
    throw makeAdvanceError(
      "ROOM_ADVANCE_DISABLED",
      "Advance payments are disabled for this hotel.",
      409
    );
  }
  if (!actorIsManager && !policy.allowStaffAdvance) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_STAFF_NOT_ALLOWED",
      "This hotel's policy does not allow Staff to record a booking advance.",
      403
    );
  }
  if (!policy.schemaReady) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_SCHEMA_REQUIRED",
      "Apply the Manual Room Booking Advance Payment migration before recording an advance.",
      409
    );
  }

  if (!rawLines.length) {
    rawLines = [{
      amount: option === "full" ? trustedTotal : requestedAmount,
      paymentMethod: fallbackMethod
    }];
  } else if (option === "full" && rawLines.length === 1 && !rawLines[0]?.amount) {
    rawLines = [{ ...rawLines[0], amount: trustedTotal }];
  }

  const payments = rawLines.map((line) => normalizePaymentLine(line, fallbackMethod));
  if (option === "split" && payments.length < 2) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_SPLIT_LINES_REQUIRED",
      "Split Advance requires at least two payment method lines."
    );
  }
  if (payments.length > 1 && !policy.allowSplitPayments) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_SPLIT_DISABLED",
      "Split advance payments are disabled for this hotel.",
      409
    );
  }
  if (payments.length > 10) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_SPLIT_LIMIT",
      "A maximum of 10 split payment lines is supported."
    );
  }

  for (const payment of payments) {
    if (payment.amount <= 0) {
      throw makeAdvanceError(
        "ROOM_ADVANCE_AMOUNT_INVALID",
        "Each advance payment amount must be greater than zero."
      );
    }
    if (!PAYMENT_METHOD_PATTERN.test(payment.paymentMethod)) {
      throw makeAdvanceError(
        "ROOM_ADVANCE_METHOD_INVALID",
        "Choose a valid payment method for every advance payment line."
      );
    }
    if (!policy.allowedPaymentMethods.includes(payment.paymentMethod)) {
      throw makeAdvanceError(
        "ROOM_ADVANCE_METHOD_DISABLED",
        "This payment method is currently unavailable for this hotel.",
        409
      );
    }
  }

  const paymentTotal = roundMoney(
    payments.reduce((sum, payment) => sum + payment.amount, 0)
  );
  if (paymentTotal > trustedTotal) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_EXCEEDS_TOTAL",
      "The advance payment cannot exceed the current booking amount."
    );
  }
  if (option === "full" && paymentTotal !== trustedTotal) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_FULL_MISMATCH",
      "Full Advance must equal the verified booking total."
    );
  }
  if (option === "partial" && (paymentTotal <= 0 || paymentTotal >= trustedTotal)) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_PARTIAL_INVALID",
      "Partial Advance must be greater than zero and less than the verified booking total."
    );
  }

  const minimumAdvance = getMinimumAdvance(policy, trustedTotal);
  if (paymentTotal < minimumAdvance) {
    throw makeAdvanceError(
      "ROOM_ADVANCE_MINIMUM_NOT_MET",
      `The advance payment must be at least ${policy.currency} ${minimumAdvance.toFixed(2)}.`
    );
  }

  const balanceAmount = roundMoney(Math.max(0, trustedTotal - paymentTotal));
  return {
    option: payments.length > 1 ? "split" : option,
    totalAmount: paymentTotal,
    balanceAmount,
    paymentStatus: balanceAmount <= 0 ? "paid" : "partial",
    currency: policy.currency,
    payments
  };
}

function buildAdvanceSummary({ booking = {}, payments = [], policy = null } = {}) {
  const verifiedPayments = (Array.isArray(payments) ? payments : []).filter(
    (payment) => String(payment.payment_status || "").toLowerCase() === "paid"
  );
  const grossPaidAmount = roundMoney(
    verifiedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
  const storedNetPaid = Number(booking.advance_paid);
  const paidAmount = Number.isFinite(storedNetPaid)
    ? roundMoney(Math.max(0, storedNetPaid))
    : grossPaidAmount;
  const refundedAmount = roundMoney(
    Math.max(0, Number(booking.refunded_amount || 0), grossPaidAmount - paidAmount)
  );
  const grandTotal = roundMoney(booking.total_amount || 0);
  const storedBalance = Number(booking.balance_amount);
  const balance = Number.isFinite(storedBalance)
    ? roundMoney(Math.max(0, storedBalance))
    : roundMoney(Math.max(0, grandTotal - paidAmount));
  return {
    grandTotal,
    paidAmount,
    refundedAmount,
    balance,
    paymentStatus: paidAmount <= 0 ? "unpaid" : balance <= 0 ? "paid" : "partial",
    currency: policy?.currency || "INR"
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableJson(value[key]);
    return result;
  }, {});
}

function hashRoomAdvanceRequest(value = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableJson(value)))
    .digest("hex");
}

function maskProviderReference(value = "") {
  const reference = normalizeText(value, 200);
  if (!reference) return "";
  if (reference.length <= 4) return "*".repeat(reference.length);
  return `${"*".repeat(Math.min(8, reference.length - 4))}${reference.slice(-4)}`;
}

function buildRoomAdvanceReceipt({ booking = {}, payment = {}, hotel = null } = {}) {
  const reference = payment.receipt_reference || `AR-LEGACY-${payment.id || "UNKNOWN"}`;
  return {
    reference,
    receiptType: "booking_advance",
    hotel: hotel ? {
      name: hotel.name || hotel.hotel_name || "",
      gstin: hotel.gstin || "",
      address: hotel.address || ""
    } : null,
    booking: {
      reference: String(booking.id || ""),
      guestName: booking.guest_name || "",
      roomId: booking.room_id || null,
      checkInDate: booking.check_in_date || "",
      checkOutDate: booking.check_out_date || ""
    },
    payment: {
      amount: roundMoney(payment.amount || 0),
      method: payment.payment_method || "",
      status: payment.payment_status || "",
      type: payment.payment_type || "booking_advance",
      groupReference: payment.payment_group_id || "",
      providerReferenceMasked: maskProviderReference(
        payment.provider_reference || payment.transaction_id || ""
      ),
      receivedAt: payment.paid_at || payment.created_at || "",
      receivedBy: payment.received_by || ""
    },
    summary: {
      grandTotal: roundMoney(booking.total_amount || 0),
      paidAmount: roundMoney(booking.advance_paid || 0),
      balance: roundMoney(booking.balance_amount || 0),
      paymentStatus: booking.payment_status || "unpaid",
      currency: payment.currency || "INR"
    }
  };
}

module.exports = {
  DEFAULT_ROOM_ADVANCE_POLICY,
  buildAdvanceSummary,
  buildRoomAdvancePlan,
  buildRoomAdvanceReceipt,
  fetchRoomAdvancePolicy,
  hashRoomAdvanceRequest,
  isMissingAdvanceSchemaError,
  normalizeRoomAdvancePolicy,
  roundMoney
};
