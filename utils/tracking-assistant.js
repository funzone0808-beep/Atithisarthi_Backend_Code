const CLOSED_TRACKING_STATUSES = new Set(["completed", "cancelled", "payment_failed"]);
const TRACKING_STATUS_LABELS = {
  new: "Received",
  confirmed: "Confirmed",
  preparing: "Preparing",
  completed: "Completed / Served",
  cancelled: "Cancelled",
  payment_pending: "Payment Pending",
  payment_failed: "Payment Failed"
};
const TRACKING_STATUS_DETAILS = {
  new: "The hotel has received your order.",
  confirmed: "The hotel has confirmed your order.",
  preparing: "The kitchen is preparing your order now.",
  completed: "The hotel has marked your order completed.",
  cancelled: "The hotel has marked this order cancelled.",
  payment_pending: "Online payment is still being confirmed for this order.",
  payment_failed: "Online payment could not be confirmed for this order."
};

function normalizeTrackingAssistantText(value = "", maxLength = 160) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength)
    : "";
}

function normalizeTrackingAssistantTone(value = "") {
  const candidate = normalizeTrackingAssistantText(value, 40).toLowerCase();
  return ["friendly", "formal"].includes(candidate) ? candidate : "default";
}

function normalizeTrackingStatus(value = "") {
  return normalizeTrackingAssistantText(value, 60).toLowerCase();
}

function getTonePhrase(tone = "default", variants = {}) {
  if (tone === "friendly" && variants.friendly) {
    return variants.friendly;
  }

  if (tone === "formal" && variants.formal) {
    return variants.formal;
  }

  return variants.default || "";
}

function hasReadOnlyTrackingAssistantContext(context = {}) {
  const pageScope = normalizeTrackingAssistantText(context?.pageScope, 40).toLowerCase();
  const trackingOrderId = normalizeTrackingAssistantText(context?.trackingOrderId, 120);
  const trackingToken = normalizeTrackingAssistantText(context?.trackingToken, 200);

  return pageScope === "order_tracking" && !!trackingOrderId && !!trackingToken;
}

function detectReadOnlyTrackingAssistantIntent(message = "") {
  const normalizedMessage = normalizeTrackingAssistantText(message, 500).toLowerCase();

  if (
    /\b(order status|status of my order|what(?:'s| is) my order status|where is my order)\b/.test(
      normalizedMessage
    ) ||
    /\btrack\b.*\border\b/.test(normalizedMessage)
  ) {
    return "order_status";
  }

  if (
    /\b(can i add more|add more items|more items|add more to this order)\b/.test(
      normalizedMessage
    )
  ) {
    return "can_add_more";
  }

  if (
    /\b(is (?:my |the )?bill ready|bill ready|view bill)\b/.test(normalizedMessage)
  ) {
    return "bill_ready";
  }

  if (
    /\b(request (?:the )?bill|bill request|how do i request (?:the )?bill)\b/.test(
      normalizedMessage
    )
  ) {
    return "request_bill";
  }

  if (
    /\b(call staff|staff help|how do i call staff|how do i get staff help|need help at my table)\b/.test(
      normalizedMessage
    )
  ) {
    return "call_staff";
  }

  return "";
}

function isClosedTrackingStatus(status = "") {
  return CLOSED_TRACKING_STATUSES.has(normalizeTrackingStatus(status));
}

function isTableOrder(order = {}) {
  const tableNumber = normalizeTrackingAssistantText(order.table_number, 80);
  const orderSource = normalizeTrackingAssistantText(order.order_source, 40).toLowerCase();
  const orderType = normalizeTrackingAssistantText(order.order_type, 40).toLowerCase();

  return Boolean(
    tableNumber ||
    orderSource === "qr" ||
    orderSource === "table" ||
    orderType === "dine-in" ||
    orderType === "dine_in"
  );
}

function canAddMoreItems(order = {}) {
  const status = normalizeTrackingStatus(order.status);
  const paymentStatus = normalizeTrackingStatus(order.payment_status);
  const billingStatus = normalizeTrackingStatus(order.billing_status);

  return (
    isTableOrder(order) &&
    !isClosedTrackingStatus(status) &&
    status !== "payment_pending" &&
    !["paid", "refunded"].includes(paymentStatus) &&
    !["bill_ready", "billed", "closed"].includes(billingStatus)
  );
}

function canViewBill(order = {}) {
  const billNumber = normalizeTrackingAssistantText(order.bill_number, 120);
  const billingStatus = normalizeTrackingStatus(order.billing_status);
  const paymentStatus = normalizeTrackingStatus(order.payment_status);

  return Boolean(
    billNumber ||
    ["billed", "closed"].includes(billingStatus) ||
    paymentStatus === "paid"
  );
}

function canUseTableSupport(order = {}) {
  return isTableOrder(order) && !isClosedTrackingStatus(order.status);
}

function getOrderStatusLabel(status = "") {
  const normalizedStatus = normalizeTrackingStatus(status);
  return TRACKING_STATUS_LABELS[normalizedStatus] || normalizedStatus || "Received";
}

function getOrderStatusDetail(status = "") {
  const normalizedStatus = normalizeTrackingStatus(status);
  return (
    TRACKING_STATUS_DETAILS[normalizedStatus] ||
    "The hotel team will keep updating this order through the regular tracking page."
  );
}

function getOrderLead(order = {}) {
  const tableNumber = normalizeTrackingAssistantText(order.table_number, 80);
  return tableNumber
    ? `For Table ${tableNumber}, `
    : "For this tracked order, ";
}

function getAddMoreBlockedReason(order = {}) {
  const status = normalizeTrackingStatus(order.status);
  const paymentStatus = normalizeTrackingStatus(order.payment_status);
  const billingStatus = normalizeTrackingStatus(order.billing_status);

  if (!isTableOrder(order)) {
    return "this is not a QR/table dine-in order";
  }

  if (isClosedTrackingStatus(status)) {
    return "this order is already closed";
  }

  if (status === "payment_pending") {
    return "payment is still being confirmed";
  }

  if (["paid", "refunded"].includes(paymentStatus)) {
    return "this order is already paid or refunded";
  }

  if (["bill_ready", "billed", "closed"].includes(billingStatus)) {
    return "the bill is already ready or closed";
  }

  return "the hotel has locked add-on ordering for this order";
}

function buildTrackingFollowUpPrompts(intent = "", order = {}) {
  const prompts = [];
  const canAddItems = canAddMoreItems(order);
  const canUseSupport = canUseTableSupport(order);

  function addPrompt(value = "") {
    const prompt = normalizeTrackingAssistantText(value, 120);
    if (!prompt || prompts.includes(prompt)) {
      return;
    }

    prompts.push(prompt);
  }

  if (intent !== "order_status") {
    addPrompt("What is my order status?");
  }

  if (intent !== "can_add_more") {
    addPrompt("Can I add more items?");
  }

  if (intent !== "bill_ready") {
    addPrompt("Is my bill ready?");
  }

  if (canUseSupport && intent !== "request_bill") {
    addPrompt("How do I request the bill?");
  }

  if (canUseSupport && intent !== "call_staff") {
    addPrompt("How do I call staff?");
  }

  if (canAddItems) {
    addPrompt("Suggest something light to add");
  }

  return prompts.slice(0, 4);
}

function buildTrackingUnavailableAnswer(hotelName = "", tone = "default") {
  return getTonePhrase(tone, {
    default: `I could not safely read the current ${hotelName} tracking state from this link right now. Please use the regular Refresh Status button on the tracking page.`,
    friendly: `I could not safely read the current ${hotelName} tracking state from this link right now. Please use the regular Refresh Status button on the tracking page.`,
    formal: `I could not safely read the current ${hotelName} tracking state from this link at the moment. Please use the regular Refresh Status button on the tracking page.`
  });
}

function buildOrderStatusAnswer(hotelName = "", order = {}, tone = "default") {
  const statusLabel = getOrderStatusLabel(order.status);
  const statusDetail = getOrderStatusDetail(order.status);
  const orderLead = getOrderLead(order);

  return `${orderLead}${getTonePhrase(tone, {
    default: `your current ${hotelName} order status is ${statusLabel}. ${statusDetail}`,
    friendly: `your current ${hotelName} order status is ${statusLabel}. ${statusDetail}`,
    formal: `the current ${hotelName} order status is ${statusLabel}. ${statusDetail}`
  })}`;
}

function buildAddMoreAnswer(hotelName = "", order = {}, tone = "default") {
  const orderLead = getOrderLead(order);

  if (canAddMoreItems(order)) {
    return `${orderLead}${getTonePhrase(tone, {
      default: `yes, you can still add more items to this ${hotelName} order right now.`,
      friendly: `yes, you can still add more items to this ${hotelName} order right now.`,
      formal: `yes, additional items can still be added to this ${hotelName} order right now.`
    })}`;
  }

  return `${orderLead}${getTonePhrase(tone, {
    default: `no, you cannot add more items right now because ${getAddMoreBlockedReason(order)}.`,
    friendly: `no, you cannot add more items right now because ${getAddMoreBlockedReason(order)}.`,
    formal: `no, additional items are not available right now because ${getAddMoreBlockedReason(order)}.`
  })}`;
}

function buildBillReadyAnswer(hotelName = "", order = {}, tone = "default") {
  const billNumber = normalizeTrackingAssistantText(order.bill_number, 120);
  const orderLead = getOrderLead(order);

  if (canViewBill(order)) {
    const billSuffix = billNumber ? ` Bill ${billNumber} is available.` : " Your bill is available to review.";
    return `${orderLead}${getTonePhrase(tone, {
      default: `yes, the bill is ready for this ${hotelName} order.${billSuffix}`,
      friendly: `yes, the bill is ready for this ${hotelName} order.${billSuffix}`,
      formal: `yes, the bill is ready for this ${hotelName} order.${billSuffix}`
    })}`;
  }

  return `${orderLead}${getTonePhrase(tone, {
    default: `not yet, the bill is not ready for this ${hotelName} order.`,
    friendly: `not yet, the bill is not ready for this ${hotelName} order.`,
    formal: `not yet, the bill is not ready for this ${hotelName} order.`
  })}`;
}

function buildRequestBillAnswer(hotelName = "", order = {}, tone = "default") {
  const orderLead = getOrderLead(order);

  if (!canUseTableSupport(order)) {
    return `${orderLead}${getTonePhrase(tone, {
      default: `the regular bill-request control is not available for this ${hotelName} order right now.`,
      friendly: `the regular bill-request control is not available for this ${hotelName} order right now.`,
      formal: `the regular bill-request control is not available for this ${hotelName} order right now.`
    })}`;
  }

  if (canViewBill(order)) {
    return `${orderLead}${getTonePhrase(tone, {
      default: `your bill is already available, so you can use the regular View Bill control on this page first.`,
      friendly: `your bill is already available, so you can use the regular View Bill control on this page first.`,
      formal: `your bill is already available, so you may use the regular View Bill control on this page first.`
    })}`;
  }

  return `${orderLead}${getTonePhrase(tone, {
    default: `use the regular Request Bill control in the table support section on this page. Smart Waiter will only guide you there and will not send the request itself.`,
    friendly: `use the regular Request Bill control in the table support section on this page. Smart Waiter will only guide you there and will not send the request itself.`,
    formal: `please use the regular Request Bill control in the table support section on this page. Smart Waiter will only guide you there and will not send the request itself.`
  })}`;
}

function buildCallStaffAnswer(hotelName = "", order = {}, tone = "default") {
  const orderLead = getOrderLead(order);

  if (!canUseTableSupport(order)) {
    return `${orderLead}${getTonePhrase(tone, {
      default: `the regular Call Staff control is not available for this ${hotelName} order right now.`,
      friendly: `the regular Call Staff control is not available for this ${hotelName} order right now.`,
      formal: `the regular Call Staff control is not available for this ${hotelName} order right now.`
    })}`;
  }

  return `${orderLead}${getTonePhrase(tone, {
    default: `use the regular Call Staff control in the table support section on this page. Smart Waiter will only guide you there and will not create the request itself.`,
    friendly: `use the regular Call Staff control in the table support section on this page. Smart Waiter will only guide you there and will not create the request itself.`,
    formal: `please use the regular Call Staff control in the table support section on this page. Smart Waiter will only guide you there and will not create the request itself.`
  })}`;
}

function buildReadOnlyTrackingAssistantReply({
  hotelName = "this hotel",
  message = "",
  context = {},
  trackedOrder = null,
  tone = "default"
}) {
  const intent = detectReadOnlyTrackingAssistantIntent(message);

  if (!intent || !hasReadOnlyTrackingAssistantContext(context)) {
    return null;
  }

  const assistantTone = normalizeTrackingAssistantTone(tone);

  if (!trackedOrder || typeof trackedOrder !== "object") {
    return {
      answer: buildTrackingUnavailableAnswer(hotelName, assistantTone),
      suggestions: [],
      suggestedActions: [],
      followUpPrompts: buildTrackingFollowUpPrompts(intent),
      meta: {
        mode: "tracking_unavailable",
        groundedItemCount: 0,
        trackingScope: "token_scoped",
        trackingIntent: intent
      }
    };
  }

  let answer = "";
  let mode = "";

  if (intent === "order_status") {
    answer = buildOrderStatusAnswer(hotelName, trackedOrder, assistantTone);
    mode = "tracking_order_status";
  } else if (intent === "can_add_more") {
    answer = buildAddMoreAnswer(hotelName, trackedOrder, assistantTone);
    mode = "tracking_add_more";
  } else if (intent === "bill_ready") {
    answer = buildBillReadyAnswer(hotelName, trackedOrder, assistantTone);
    mode = "tracking_bill_ready";
  } else if (intent === "request_bill") {
    answer = buildRequestBillAnswer(hotelName, trackedOrder, assistantTone);
    mode = "tracking_request_bill";
  } else if (intent === "call_staff") {
    answer = buildCallStaffAnswer(hotelName, trackedOrder, assistantTone);
    mode = "tracking_call_staff";
  }

  return {
    answer,
    suggestions: [],
    suggestedActions: [],
    followUpPrompts: buildTrackingFollowUpPrompts(intent, trackedOrder),
    meta: {
      mode,
      groundedItemCount: 0,
      trackingScope: "token_scoped",
      trackingIntent: intent,
      trackingStatus: normalizeTrackingStatus(trackedOrder.status),
      trackingPaymentStatus: normalizeTrackingStatus(trackedOrder.payment_status),
      trackingBillingStatus: normalizeTrackingStatus(trackedOrder.billing_status)
    }
  };
}

module.exports = {
  buildReadOnlyTrackingAssistantReply,
  detectReadOnlyTrackingAssistantIntent,
  hasReadOnlyTrackingAssistantContext
};
