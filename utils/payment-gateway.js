const crypto = require("crypto");
const { env } = require("../config/env");

const SUPPORTED_PAYMENT_GATEWAYS = ["razorpay"];

function normalizeProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  return SUPPORTED_PAYMENT_GATEWAYS.includes(provider) ? provider : "razorpay";
}

function getPaymentGatewayConfig() {
  const provider = normalizeProvider(env.paymentGatewayProvider);

  return {
    enabled: !!env.paymentGatewayEnabled,
    isProduction: !!env.isProduction,
    provider,
    currency: String(env.paymentGatewayCurrency || "INR").trim().toUpperCase() || "INR",
    routeTransfersEnabled: !!env.paymentRouteTransfersEnabled,
    razorpay: {
      keyId: env.razorpayKeyId || "",
      keySecret: env.razorpayKeySecret || "",
      webhookSecret: env.razorpayWebhookSecret || "",
      apiBaseUrl: String(env.razorpayApiBaseUrl || "https://api.razorpay.com/v1").replace(/\/$/, "")
    }
  };
}

function getPaymentGatewaySafetyIssue(config = getPaymentGatewayConfig()) {
  if (!config.enabled) {
    return "";
  }

  if (
    config.provider === "razorpay" &&
    !config.isProduction &&
    config.razorpay.keyId &&
    !config.razorpay.keyId.startsWith("rzp_test_")
  ) {
    return "Refusing to use a non-test Razorpay key outside production";
  }

  return "";
}

function isPaymentGatewayConfigured() {
  const config = getPaymentGatewayConfig();

  if (!config.enabled) {
    return false;
  }

  if (getPaymentGatewaySafetyIssue(config)) {
    return false;
  }

  if (config.provider === "razorpay") {
    return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
  }

  return false;
}

function assertPaymentGatewayConfigured() {
  const config = getPaymentGatewayConfig();
  const safetyIssue = getPaymentGatewaySafetyIssue(config);

  if (safetyIssue) {
    throw new Error(safetyIssue);
  }

  if (!isPaymentGatewayConfigured()) {
    throw new Error("Payment gateway is not configured");
  }
}

function toGatewayMinorAmount(amount) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  return Math.round(numericAmount * 100);
}

function buildRazorpayAuthHeader(keyId, keySecret) {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

function normalizeRazorpayTransfers(transfers = []) {
  if (!Array.isArray(transfers)) {
    return [];
  }

  return transfers
    .map((transfer) => {
      const account = String(transfer?.account || "").trim();
      const amountMinor = Number(transfer?.amount || 0);
      const currency = String(transfer?.currency || "INR").trim().toUpperCase();
      const notes =
        transfer?.notes &&
        typeof transfer.notes === "object" &&
        !Array.isArray(transfer.notes)
          ? transfer.notes
          : {};
      const linkedAccountNotes = Array.isArray(transfer?.linked_account_notes)
        ? transfer.linked_account_notes
            .map((key) => String(key || "").trim())
            .filter((key) => key && Object.prototype.hasOwnProperty.call(notes, key))
        : [];
      const normalizedTransfer = {
        account,
        amount: Math.round(amountMinor),
        currency,
        notes,
        on_hold: transfer?.on_hold === true
      };

      if (linkedAccountNotes.length) {
        normalizedTransfer.linked_account_notes = linkedAccountNotes;
      }

      if (transfer?.on_hold_until) {
        normalizedTransfer.on_hold_until = transfer.on_hold_until;
      }

      return normalizedTransfer;
    })
    .filter((transfer) => (
      /^acc_[A-Za-z0-9]+$/.test(transfer.account) &&
      Number.isInteger(transfer.amount) &&
      transfer.amount > 0 &&
      transfer.currency === "INR"
    ));
}

async function createRazorpayOrder({ amount, currency, receipt, notes, transfers } = {}) {
  const config = getPaymentGatewayConfig();
  assertPaymentGatewayConfigured();

  const amountMinor = toGatewayMinorAmount(amount);
  const normalizedTransfers = normalizeRazorpayTransfers(transfers);
  const requestBody = {
    amount: amountMinor,
    currency: currency || config.currency,
    receipt,
    notes: notes || {},
    payment_capture: 1
  };

  if (normalizedTransfers.length) {
    requestBody.transfers = normalizedTransfers;
    requestBody.partial_payment = false;
  }

  const response = await fetch(`${config.razorpay.apiBaseUrl}/orders`, {
    method: "POST",
    headers: {
      Authorization: buildRazorpayAuthHeader(
        config.razorpay.keyId,
        config.razorpay.keySecret
      ),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.description || data?.message || "Failed to create payment order";
    throw new Error(message);
  }

  return {
    provider: "razorpay",
    keyId: config.razorpay.keyId,
    gatewayOrderId: data.id,
    gatewayStatus: data.status || "created",
    amount: amountMinor / 100,
    amountMinor,
    currency: data.currency || currency || config.currency,
    receipt: data.receipt || receipt || "",
    transfers: Array.isArray(data.transfers) ? data.transfers : [],
    transfersRequested: normalizedTransfers,
    raw: data
  };
}

async function fetchRazorpayOrderPayments(gatewayOrderId = "") {
  const config = getPaymentGatewayConfig();
  assertPaymentGatewayConfigured();

  const orderId = String(gatewayOrderId || "").trim();

  if (!orderId) {
    throw new Error("Gateway order id is required");
  }

  const response = await fetch(
    `${config.razorpay.apiBaseUrl}/orders/${encodeURIComponent(orderId)}/payments`,
    {
      method: "GET",
      headers: {
        Authorization: buildRazorpayAuthHeader(
          config.razorpay.keyId,
          config.razorpay.keySecret
        )
      }
    }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.description || data?.message || "Failed to fetch payment status";
    throw new Error(message);
  }

  return {
    provider: "razorpay",
    gatewayOrderId: orderId,
    payments: Array.isArray(data.items) ? data.items : [],
    raw: data
  };
}

function verifyRazorpaySignature({ gatewayOrderId, gatewayPaymentId, gatewaySignature } = {}) {
  const config = getPaymentGatewayConfig();
  assertPaymentGatewayConfigured();

  const orderId = String(gatewayOrderId || "").trim();
  const paymentId = String(gatewayPaymentId || "").trim();
  const signature = String(gatewaySignature || "").trim();

  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", config.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifyRazorpayWebhookSignature({ rawBody, gatewaySignature } = {}) {
  const config = getPaymentGatewayConfig();
  const webhookSecret = String(config.razorpay.webhookSecret || "").trim();
  const signature = String(gatewaySignature || "").trim();

  if (!webhookSecret || !rawBody || !signature) {
    return false;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody));
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(bodyBuffer)
    .digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function createPaymentGatewayOrder(payload = {}) {
  const config = getPaymentGatewayConfig();

  if (config.provider === "razorpay") {
    return createRazorpayOrder(payload);
  }

  throw new Error("Unsupported payment gateway provider");
}

async function fetchPaymentGatewayOrderPayments(gatewayOrderId = "") {
  const config = getPaymentGatewayConfig();

  if (config.provider === "razorpay") {
    return fetchRazorpayOrderPayments(gatewayOrderId);
  }

  throw new Error("Unsupported payment gateway provider");
}

function verifyPaymentGatewaySignature(payload = {}) {
  const config = getPaymentGatewayConfig();

  if (config.provider === "razorpay") {
    return verifyRazorpaySignature(payload);
  }

  return false;
}

module.exports = {
  getPaymentGatewayConfig,
  getPaymentGatewaySafetyIssue,
  isPaymentGatewayConfigured,
  createPaymentGatewayOrder,
  fetchPaymentGatewayOrderPayments,
  verifyPaymentGatewaySignature,
  verifyRazorpayWebhookSignature,
  toGatewayMinorAmount
};
