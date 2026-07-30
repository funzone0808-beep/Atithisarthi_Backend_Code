"use strict";

const NON_BILLABLE_ORDER_STATUSES = ["cancelled", "payment_failed"];

function roundMoney(value = 0) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round(numericValue * 100) / 100;
}

function getNumberValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" && !value.trim()) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getOrderItemsSubtotal(order = {}) {
  return Array.isArray(order.items)
    ? order.items.reduce((sum, item) => {
      const quantity = getNumberValue(item?.qty) || 0;
      const price = getNumberValue(item?.price) || 0;
      return sum + quantity * price;
    }, 0)
    : 0;
}

function getOrderTotalAmount(order = {}) {
  const totals =
    order.totals && typeof order.totals === "object" && !Array.isArray(order.totals)
      ? order.totals
      : {};

  return roundMoney(
    getNumberValue(totals.gpayFinalTotal) ??
    getNumberValue(totals.final) ??
    getNumberValue(totals.total) ??
    getNumberValue(totals.normalTotal) ??
    getOrderItemsSubtotal(order)
  );
}

function isOrderBillable(order = {}) {
  return !NON_BILLABLE_ORDER_STATUSES.includes(
    String(order.status || "").trim().toLowerCase()
  );
}

function isPaidOrder(order = {}) {
  return ["paid", "refunded"].includes(
    String(order.paymentStatus || order.payment_status || "").trim().toLowerCase()
  );
}

function buildCheckoutFoodOrderResponse(order = {}) {
  const totalAmount = getOrderTotalAmount(order);
  const chargeToRoom = order.room_service_charge_to_room === true;

  return {
    id: order.id,
    status: order.status || "new",
    paymentMethod: order.payment_method || "",
    paymentStatus: order.payment_status || "",
    billingStatus: order.billing_status || "",
    roomNumber: order.room_number || "",
    guestName: order.room_service_guest_name || "",
    chargeToRoom,
    billable: isOrderBillable(order),
    totalAmount,
    createdAt: order.created_at || ""
  };
}

function buildRoomCheckoutSummary({ booking = {}, room = null, foodOrders = [] } = {}) {
  const roomTotalAmount = roundMoney(booking.total_amount || 0);
  const roomAdvancePaid = roundMoney(booking.advance_paid || 0);
  const storedRoomBalance = getNumberValue(booking.balance_amount);
  const roomBalanceAmount = roundMoney(
    Math.max(0, storedRoomBalance ?? roomTotalAmount - roomAdvancePaid)
  );
  const orderRows = (Array.isArray(foodOrders) ? foodOrders : []).map(buildCheckoutFoodOrderResponse);
  const billableOrders = orderRows.filter((order) => order.billable);
  const chargeToRoomOrders = billableOrders.filter((order) => order.chargeToRoom);
  const separateOrders = billableOrders.filter((order) => !order.chargeToRoom);
  const chargeToRoomAmount = roundMoney(
    chargeToRoomOrders.reduce((sum, order) => sum + order.totalAmount, 0)
  );
  const paidChargeToRoomAmount = roundMoney(
    chargeToRoomOrders
      .filter((order) => isPaidOrder(order))
      .reduce((sum, order) => sum + order.totalAmount, 0)
  );
  const outstandingChargeToRoomAmount = roundMoney(
    Math.max(0, chargeToRoomAmount - paidChargeToRoomAmount)
  );
  const separateFoodAmount = roundMoney(
    separateOrders.reduce((sum, order) => sum + order.totalAmount, 0)
  );
  const separatePaidAmount = roundMoney(
    separateOrders
      .filter((order) => isPaidOrder(order))
      .reduce((sum, order) => sum + order.totalAmount, 0)
  );
  const separateUnpaidAmount = roundMoney(Math.max(0, separateFoodAmount - separatePaidAmount));
  const finalPayableAmount = roundMoney(roomBalanceAmount + outstandingChargeToRoomAmount);

  return {
    booking: {
      id: booking.id,
      roomId: booking.room_id,
      roomNumber: room?.room_number || booking.room_number || "",
      guestName: booking.guest_name || "",
      guestPhone: booking.guest_phone || "",
      checkInDate: booking.check_in_date || "",
      checkOutDate: booking.check_out_date || "",
      bookingStatus: booking.booking_status || "",
      paymentStatus: booking.payment_status || ""
    },
    roomCharges: {
      roomPrice: roundMoney(booking.room_price || 0),
      taxAmount: roundMoney(booking.tax_amount || 0),
      discountAmount: roundMoney(booking.discount_amount || 0),
      totalAmount: roomTotalAmount,
      advancePaid: roomAdvancePaid,
      balanceAmount: roomBalanceAmount
    },
    foodCharges: {
      orderCount: orderRows.length,
      billableOrderCount: billableOrders.length,
      chargeToRoomAmount,
      paidChargeToRoomAmount,
      outstandingChargeToRoomAmount,
      separateFoodAmount,
      separatePaidAmount,
      separateUnpaidAmount,
      orders: orderRows
    },
    totals: {
      roomBalanceAmount,
      outstandingChargeToRoomAmount,
      finalPayableAmount
    }
  };
}

module.exports = {
  buildRoomCheckoutSummary,
  getNumberValue,
  roundMoney
};