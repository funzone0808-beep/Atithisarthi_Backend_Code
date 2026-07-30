"use strict";

const { roundMoney, taxLinesFromSnapshot } = require("./room-tax");

function token(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16) || "HOTEL";
}

function buildRoomRefundCreditNote({ booking = {}, refund = {} } = {}) {
  const refundAmount = roundMoney(Math.max(0, Number(refund.amount || 0)));
  const originalTotal = roundMoney(Math.max(0, Number(booking.total_amount || 0)));
  const ratio = originalTotal > 0 ? Math.min(1, refundAmount / originalTotal) : 0;
  const taxSnapshot = (
    booking.tax_snapshot && Object.keys(booking.tax_snapshot).length
      ? booking.tax_snapshot
      : booking.pricing_snapshot?.taxSnapshot
  ) || refund.tax_adjustment_snapshot?.originalTaxSnapshot || {};
  const taxes = taxLinesFromSnapshot(taxSnapshot).map((line) => ({
    ...line,
    amount: roundMoney(line.amount * ratio)
  })).filter((line) => line.amount !== 0);
  const taxReversal = roundMoney(taxes.reduce((sum, line) => sum + line.amount, 0));
  return {
    documentType: "room_refund_credit_note",
    creditNoteNumber: `CN-${token(booking.hotel_slug || refund.hotel_slug)}-${refund.id}`,
    bookingReference: `RB-${token(booking.hotel_slug || refund.hotel_slug)}-${booking.id || refund.booking_id}`,
    issuedAt: refund.created_at || new Date().toISOString(),
    reason: String(refund.reason || ""),
    paymentMethod: String(refund.payment_method || ""),
    transactionId: String(refund.transaction_id || ""),
    currency: taxSnapshot.currency || "INR",
    originalTotal,
    refundAmount,
    reversalRatio: roundMoney(ratio),
    taxableValueReversal: roundMoney(Number(taxSnapshot.taxableValue || 0) * ratio),
    taxes,
    taxReversal,
    netValueReversal: roundMoney(Math.max(0, refundAmount - taxReversal)),
    originalTaxRuleId: booking.tax_rule_id || taxSnapshot.ruleId || null,
    originalTaxRuleVersion: taxSnapshot.ruleVersion || null,
    immutableSource: true
  };
}

module.exports = { buildRoomRefundCreditNote };
