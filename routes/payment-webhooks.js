const express = require("express");
const { supabase } = require("../utils/supabase");
const logger = require("../utils/logger");
const { createNotificationEventSafely } = require("../utils/notifications");
const {
  getPaymentGatewayConfig,
  verifyRazorpayWebhookSignature
} = require("../utils/payment-gateway");

const router = express.Router();

function normalizeOptionalText(value, maxLength = 120) {
  const text = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
    : "";
  return text.slice(0, maxLength);
}

function getWebhookLogMeta({
  requestId = "",
  eventId = "",
  eventType = "",
  gatewayOrderId = "",
  gatewayPaymentId = "",
  gatewayTransferId = "",
  action = "",
  reason = "",
  localOrderId = ""
} = {}) {
  const meta = {
    provider: "razorpay"
  };
  const normalizedRequestId = normalizeOptionalText(requestId, 120);
  const normalizedEventId = normalizeOptionalText(eventId, 260);
  const normalizedEventType = normalizeOptionalText(eventType, 120);
  const normalizedGatewayOrderId = normalizeOptionalText(gatewayOrderId, 200);
  const normalizedGatewayPaymentId = normalizeOptionalText(gatewayPaymentId, 200);
  const normalizedGatewayTransferId = normalizeOptionalText(gatewayTransferId, 200);
  const normalizedAction = normalizeOptionalText(action, 80);
  const normalizedReason = normalizeOptionalText(reason, 160);
  const normalizedLocalOrderId = normalizeOptionalText(localOrderId, 80);

  if (normalizedRequestId) {
    meta.requestId = normalizedRequestId;
  }

  if (normalizedEventId) {
    meta.eventId = normalizedEventId;
  }

  if (normalizedEventType) {
    meta.eventType = normalizedEventType;
  }

  if (normalizedGatewayOrderId) {
    meta.gatewayOrderId = normalizedGatewayOrderId;
  }

  if (normalizedGatewayPaymentId) {
    meta.gatewayPaymentId = normalizedGatewayPaymentId;
  }

  if (normalizedGatewayTransferId) {
    meta.gatewayTransferId = normalizedGatewayTransferId;
  }

  if (normalizedAction) {
    meta.action = normalizedAction;
  }

  if (normalizedReason) {
    meta.reason = normalizedReason;
  }

  if (normalizedLocalOrderId) {
    meta.localOrderId = normalizedLocalOrderId;
  }

  return meta;
}

function isMissingWebhookEventsTableError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    details.includes("payment_webhook_events")
  );
}

function isMissingOrderRouteTransferColumnsError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();
  const routeColumns = [
    "gateway_transfer_id",
    "gateway_transfer_status",
    "gateway_settlement_status",
    "gateway_transfer_error"
  ];

  return (
    code === "PGRST204" ||
    (
      details.includes("could not find") &&
      routeColumns.some((columnName) => details.includes(columnName))
    )
  );
}

function getWebhookSignature(req) {
  return req.get("x-razorpay-signature") || "";
}

function parseWebhookBody(rawBody) {
  const rawText = Buffer.isBuffer(rawBody)
    ? rawBody.toString("utf8")
    : String(rawBody || "");

  return JSON.parse(rawText);
}

function getPaymentEntity(payload = {}) {
  return payload?.payload?.payment?.entity || {};
}

function getOrderEntity(payload = {}) {
  return payload?.payload?.order?.entity || {};
}

function getTransferEntity(payload = {}) {
  return payload?.payload?.transfer?.entity || {};
}

function getGatewayOrderId(payload = {}) {
  const payment = getPaymentEntity(payload);
  const order = getOrderEntity(payload);
  const transfer = getTransferEntity(payload);
  const transferSource = normalizeOptionalText(transfer.source || "", 200);

  return normalizeOptionalText(
    payment.order_id ||
      order.id ||
      (transferSource.startsWith("order_") ? transferSource : ""),
    200
  );
}

function getGatewayPaymentId(payload = {}) {
  const payment = getPaymentEntity(payload);
  return normalizeOptionalText(payment.id || "", 200);
}

function getGatewayTransferId(payload = {}) {
  const transfer = getTransferEntity(payload);
  return normalizeOptionalText(transfer.id || "", 200);
}

function getWebhookEventId(req, payload = {}) {
  const headerEventId = req.get("x-razorpay-event-id");
  const gatewayOrderId = getGatewayOrderId(payload);
  const gatewayPaymentId = getGatewayPaymentId(payload);
  const gatewayTransferId = getGatewayTransferId(payload);
  const eventType = normalizeOptionalText(payload.event, 120);
  const createdAt = payload.created_at ? String(payload.created_at) : "";

  return normalizeOptionalText(
    headerEventId ||
      payload.id ||
      [eventType, gatewayOrderId, gatewayPaymentId, gatewayTransferId, createdAt]
        .filter(Boolean)
        .join(":"),
    260
  );
}

async function insertWebhookEvent({
  eventId,
  eventType,
  gatewayOrderId,
  gatewayPaymentId
}) {
  const { data, error } = await supabase
    .from("payment_webhook_events")
    .insert([{
      provider: "razorpay",
      event_id: eventId,
      event_type: eventType,
      gateway_order_id: gatewayOrderId || null,
      gateway_payment_id: gatewayPaymentId || null,
      processing_status: "processing"
    }])
    .select("id")
    .single();

  if (error) {
    const code = String(error.code || "").trim();

    if (code === "23505") {
      return {
        duplicate: true
      };
    }

    if (isMissingWebhookEventsTableError(error)) {
      return {
        missingTable: true
      };
    }

    throw error;
  }

  return {
    duplicate: false,
    id: data.id
  };
}

async function updateWebhookEvent(id, updates = {}) {
  if (!id) return;

  const { error } = await supabase
    .from("payment_webhook_events")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error && !isMissingWebhookEventsTableError(error)) {
    throw error;
  }
}

async function getLinkedGatewayOrder(gatewayOrderId) {
  const { data, error } = await supabase
    .from("orders")
    .select("id,status,payment_status,gateway_status,gateway_order_id,payment_metadata")
    .eq("gateway_order_id", gatewayOrderId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function markLinkedOrderPaidFromWebhook({ gatewayOrderId, gatewayPaymentId }) {
  const order = await getLinkedGatewayOrder(gatewayOrderId);

  if (!order) {
    return {
      updated: false,
      reason: "order_not_found",
      order: null
    };
  }

  if (
    order.payment_status === "paid" &&
    order.gateway_status === "paid"
  ) {
    return {
      updated: false,
      reason: "already_paid",
      order
    };
  }

  const shouldCreateOperationalNotification =
    order.status === "payment_pending" &&
    order.payment_status !== "paid";

  const paidAt = new Date().toISOString();
  const updatePayload = {
    payment_gateway: "razorpay",
    gateway_payment_id: gatewayPaymentId || null,
    gateway_status: "paid",
    payment_status: "paid",
    payment_verified_at: paidAt,
    paid_at: paidAt
  };

  if (["payment_pending", "payment_failed"].includes(order.status)) {
    updatePayload.status = "new";
  }

  const paidOrderUpdateQuery = applyOrderNotYetPaidFilter(
    supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", order.id)
      .eq("gateway_order_id", gatewayOrderId)
  );

  const { data, error } = await paidOrderUpdateQuery
    .select("id,hotel_slug,hotel_name,customer_name,customer_phone,customer_address,payment_method,payment_status,billing_status,note,items,totals,whatsapp_message,status,table_number,order_type,order_source,gateway_status,gateway_order_id,gateway_payment_id,payment_verified_at,paid_at")
    .maybeSingle();

  if (error) throw error;

  if (data && shouldCreateOperationalNotification) {
    void createNotificationEventSafely({
      hotelSlug: data.hotel_slug || null,
      sourceType: "order",
      sourceId: data.id,
      payload: {
        orderId: data.id,
        hotelName: data.hotel_name || "",
        customerName: data.customer_name || "",
        customerPhone: data.customer_phone || "",
        customerAddress: data.customer_address || "",
        paymentMethod: data.payment_method || "Online Payment",
        paymentStatus: data.payment_status || "paid",
        billingStatus: data.billing_status || null,
        note: data.note || "",
        items: Array.isArray(data.items) ? data.items : [],
        totals:
          data.totals && typeof data.totals === "object" && !Array.isArray(data.totals)
            ? data.totals
            : {},
        whatsappMessage: data.whatsapp_message || "",
        orderContext: {
          orderType: data.order_type || "",
          tableNumber: data.table_number || "",
          orderSource: data.order_source || ""
        },
        status: data.status || "new"
      }
    });
  }

  return {
    updated: !!data,
    reason: data ? "updated" : "already_paid_by_other_request",
    order: data || null
  };
}

async function markLinkedOrderFailedFromWebhook({
  gatewayOrderId,
  gatewayPaymentId,
  reason
}) {
  const order = await getLinkedGatewayOrder(gatewayOrderId);

  if (!order) {
    return {
      updated: false,
      reason: "order_not_found",
      order: null
    };
  }

  if (
    order.payment_status === "paid" ||
    order.gateway_status === "paid"
  ) {
    return {
      updated: false,
      reason: "already_paid_not_updated",
      order
    };
  }

  const updatePayload = {
    gateway_payment_id: gatewayPaymentId || null,
    gateway_status: "failed",
    payment_status: "unpaid",
    payment_error: normalizeOptionalText(reason, 500) || "Payment failed"
  };

  if (order.status === "payment_pending") {
    updatePayload.status = "payment_failed";
  }

  const failedOrderUpdateQuery = applyOrderNotYetPaidFilter(
    supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", order.id)
      .eq("gateway_order_id", gatewayOrderId)
  );

  const { data, error } = await failedOrderUpdateQuery
    .select("id,status,payment_status,gateway_status,gateway_order_id,gateway_payment_id,payment_error")
    .maybeSingle();

  if (error) throw error;

  return {
    updated: !!data,
    reason: data ? "updated" : "already_paid_by_other_request",
    order: data || null
  };
}

function getPaymentFailureReason(payment = {}) {
  return (
    normalizeOptionalText(payment.error_description, 500) ||
    normalizeOptionalText(payment.error_reason, 500) ||
    normalizeOptionalText(payment.error_code, 500) ||
    "Payment failed"
  );
}

function applyOrderNotYetPaidFilter(query) {
  return query.or("payment_status.is.null,payment_status.neq.paid");
}

function getSafePaymentMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function getTransferStatus(transfer = {}, fallback = "") {
  return normalizeOptionalText(
    transfer.status || transfer.transfer_status || fallback,
    80
  );
}

function getTransferSettlementStatus(transfer = {}) {
  return normalizeOptionalText(transfer.settlement_status || "", 80);
}

function getTransferErrorReason(transfer = {}) {
  const error = transfer.error && typeof transfer.error === "object"
    ? transfer.error
    : {};

  return (
    normalizeOptionalText(error.description, 500) ||
    normalizeOptionalText(error.reason, 500) ||
    normalizeOptionalText(error.code, 500) ||
    normalizeOptionalText(transfer.error_description, 500) ||
    normalizeOptionalText(transfer.error_reason, 500) ||
    normalizeOptionalText(transfer.error_code, 500)
  );
}

function buildRouteTransferMetadata(existingMetadata, transferPatch = {}) {
  const metadata = getSafePaymentMetadata(existingMetadata);
  const route =
    metadata.route && typeof metadata.route === "object" && !Array.isArray(metadata.route)
      ? metadata.route
      : {};

  return {
    ...metadata,
    route: {
      ...route,
      transferId: normalizeOptionalText(transferPatch.gatewayTransferId, 200),
      transferStatus: normalizeOptionalText(transferPatch.transferStatus, 80),
      settlementStatus: normalizeOptionalText(transferPatch.settlementStatus, 80),
      linkedAccountId: normalizeOptionalText(
        transferPatch.recipient || route.linkedAccountId,
        120
      ),
      transferError: normalizeOptionalText(transferPatch.errorMessage, 500),
      transferWebhookEvent: normalizeOptionalText(transferPatch.eventType, 120),
      transferWebhookReceivedAt: new Date().toISOString()
    }
  };
}

async function markLinkedOrderTransferFromWebhook({
  gatewayOrderId,
  gatewayTransferId,
  recipient,
  transferStatus,
  settlementStatus,
  errorMessage,
  eventType
}) {
  const order = await getLinkedGatewayOrder(gatewayOrderId);

  if (!order) {
    return {
      updated: false,
      reason: "order_not_found",
      order: null
    };
  }

  const paymentMetadata = buildRouteTransferMetadata(order.payment_metadata, {
    gatewayTransferId,
    recipient,
    transferStatus,
    settlementStatus,
    errorMessage,
    eventType
  });
  const updatePayload = {
    gateway_transfer_id: gatewayTransferId || null,
    gateway_transfer_status: transferStatus || null,
    gateway_settlement_status: settlementStatus || null,
    gateway_transfer_error: errorMessage || null,
    payment_metadata: paymentMetadata
  };
  const selectColumns =
    "id,status,payment_status,gateway_status,gateway_order_id,payment_metadata";

  const { data, error } = await supabase
    .from("orders")
    .update(updatePayload)
    .eq("id", order.id)
    .eq("gateway_order_id", gatewayOrderId)
    .select(selectColumns)
    .maybeSingle();

  if (error) {
    if (isMissingOrderRouteTransferColumnsError(error)) {
      const fallbackUpdate = await supabase
        .from("orders")
        .update({ payment_metadata: paymentMetadata })
        .eq("id", order.id)
        .eq("gateway_order_id", gatewayOrderId)
        .select(selectColumns)
        .maybeSingle();

      if (fallbackUpdate.error) throw fallbackUpdate.error;

      return {
        updated: !!fallbackUpdate.data,
        reason: fallbackUpdate.data
          ? "updated_metadata_only_route_columns_missing"
          : "order_update_not_applied",
        order: fallbackUpdate.data || null
      };
    }

    throw error;
  }

  return {
    updated: !!data,
    reason: data ? "updated" : "order_update_not_applied",
    order: data || null
  };
}

async function processRazorpayPaymentEvent(payload = {}) {
  const eventType = normalizeOptionalText(payload.event, 120);
  const payment = getPaymentEntity(payload);
  const transfer = getTransferEntity(payload);
  const gatewayOrderId = getGatewayOrderId(payload);
  const gatewayPaymentId = getGatewayPaymentId(payload);

  if (!gatewayOrderId) {
    return {
      action: "skipped",
      reason: "gateway_order_id_missing",
      orderUpdate: null
    };
  }

  if (eventType.startsWith("transfer.")) {
    const transferStatus = getTransferStatus(
      transfer,
      eventType.replace(/^transfer\./, "")
    );
    const errorMessage =
      eventType === "transfer.failed" ? getTransferErrorReason(transfer) : "";

    return {
      action: "transfer",
      reason: transferStatus || eventType,
      orderUpdate: await markLinkedOrderTransferFromWebhook({
        gatewayOrderId,
        gatewayTransferId: getGatewayTransferId(payload),
        recipient: normalizeOptionalText(transfer.recipient || transfer.account, 120),
        transferStatus,
        settlementStatus: getTransferSettlementStatus(transfer),
        errorMessage,
        eventType
      })
    };
  }

  if (eventType === "payment.captured" || eventType === "order.paid") {
    return {
      action: "paid",
      reason: "captured",
      orderUpdate: await markLinkedOrderPaidFromWebhook({
        gatewayOrderId,
        gatewayPaymentId
      })
    };
  }

  if (eventType === "payment.failed") {
    return {
      action: "failed",
      reason: "payment_failed",
      orderUpdate: await markLinkedOrderFailedFromWebhook({
        gatewayOrderId,
        gatewayPaymentId,
        reason: getPaymentFailureReason(payment)
      })
    };
  }

  return {
    action: "skipped",
    reason: "unsupported_event",
    orderUpdate: null
  };
}

router.post("/", async (req, res) => {
  const config = getPaymentGatewayConfig();
  const webhookRequestMeta = getWebhookLogMeta({
    requestId: req.requestId || ""
  });

  if (!config.razorpay.webhookSecret) {
    logger.warn("Payment webhook secret is not configured", {
      ...webhookRequestMeta,
      webhookStage: "config"
    });
    return res.status(503).json({
      success: false,
      message: "Payment webhook secret is not configured"
    });
  }

  const signature = getWebhookSignature(req);

  if (!verifyRazorpayWebhookSignature({
    rawBody: req.body,
    gatewaySignature: signature
  })) {
    logger.warn("Payment webhook signature verification failed", {
      ...webhookRequestMeta,
      webhookStage: "signature"
    });
    return res.status(400).json({
      success: false,
      message: "Invalid webhook signature"
    });
  }

  let payload;

  try {
    payload = parseWebhookBody(req.body);
  } catch (error) {
    logger.warn("Payment webhook body parsing failed", {
      ...webhookRequestMeta,
      webhookStage: "parse",
      errorMessage: normalizeOptionalText(error.message, 200)
    });
    return res.status(400).json({
      success: false,
      message: "Invalid webhook body"
    });
  }

  const eventType = normalizeOptionalText(payload.event, 120);
  const gatewayOrderId = getGatewayOrderId(payload);
  const gatewayPaymentId = getGatewayPaymentId(payload);
  const gatewayTransferId = getGatewayTransferId(payload);
  const eventId = getWebhookEventId(req, payload);
  const webhookLogMeta = getWebhookLogMeta({
    ...webhookRequestMeta,
    eventId,
    eventType,
    gatewayOrderId,
    gatewayPaymentId,
    gatewayTransferId
  });

  if (!eventId) {
    logger.warn("Payment webhook event id is missing", {
      ...webhookLogMeta,
      webhookStage: "event_id"
    });
    return res.status(400).json({
      success: false,
      message: "Webhook event id is missing"
    });
  }

  res.set("x-webhook-event-id", eventId);

  const webhookEvent = await insertWebhookEvent({
    eventId,
    eventType,
    gatewayOrderId,
    gatewayPaymentId
  });

  if (webhookEvent.missingTable) {
    logger.warn("Payment webhook event table is not ready", {
      ...webhookLogMeta,
      webhookStage: "event_store"
    });
    return res.status(503).json({
      success: false,
      message: "Payment webhook event table is not ready"
    });
  }

  if (webhookEvent.duplicate) {
    logger.info("Duplicate payment webhook event received", {
      ...webhookLogMeta,
      webhookStage: "event_store",
      action: "duplicate"
    });
    return res.json({
      success: true,
      duplicate: true,
      eventId,
      message: "Webhook event already processed"
    });
  }

  try {
    const result = await processRazorpayPaymentEvent(payload);
    const localOrderId = result.orderUpdate?.order?.id
      ? String(result.orderUpdate.order.id)
      : null;

    await updateWebhookEvent(webhookEvent.id, {
      local_order_id: localOrderId,
      processing_status: result.action === "skipped" ? "skipped" : "processed",
      error_message: result.action === "skipped" ? result.reason : null,
      processed_at: new Date().toISOString()
    });

    logger.info("Payment webhook processed", {
      ...webhookLogMeta,
      webhookStage: "processed",
      action: result.action,
      reason: result.reason,
      localOrderId
    });

    res.json({
      success: true,
      duplicate: false,
      eventId,
      eventType,
      action: result.action,
      reason: result.reason,
      orderUpdated: !!result.orderUpdate?.updated,
      orderUpdateReason: result.orderUpdate?.reason || null
    });
  } catch (error) {
    await updateWebhookEvent(webhookEvent.id, {
      processing_status: "failed",
      error_message: normalizeOptionalText(error.message, 500),
      processed_at: new Date().toISOString()
    });

    logger.error("Payment webhook processing error", {
      ...webhookLogMeta,
      webhookStage: "process",
      errorMessage: normalizeOptionalText(error.message, 200)
    });
    res.status(500).json({
      success: false,
      message: "Failed to process payment webhook"
    });
  }
});

module.exports = router;
