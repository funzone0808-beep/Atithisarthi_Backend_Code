const crypto = require("crypto");
const { env } = require("../config/env");

function normalizeQrContextText(value = "", maxLength = 120) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input = "") {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64");
}

function getQrContextSigningSecret() {
  return String(env.qrContextSigningSecret || env.jwtSecret || "").trim();
}

function hasDineInQrContext(orderContext = null) {
  return orderContext?.orderType === "dine-in" && !!orderContext.tableNumber;
}

function getNormalizedClientOrderContext(orderContext = null) {
  if (!orderContext || typeof orderContext !== "object" || Array.isArray(orderContext)) {
    return {
      orderContext: null,
      qrContextToken: ""
    };
  }

  const orderType = normalizeQrContextText(orderContext.orderType, 40).toLowerCase();
  const tableNumber = normalizeQrContextText(orderContext.tableNumber, 80);
  const orderSource = normalizeQrContextText(orderContext.orderSource, 40).toLowerCase();
  const qrContextToken = normalizeQrContextText(
    orderContext.qrContextToken || orderContext.qctx,
    2000
  );

  return {
    orderContext:
      !orderType && !tableNumber && !orderSource
        ? null
        : {
            orderType: orderType || null,
            tableNumber: tableNumber || null,
            orderSource: orderSource || null
          },
    qrContextToken
  };
}

function signQrContextPayload(payloadBase64 = "") {
  return crypto
    .createHmac("sha256", getQrContextSigningSecret())
    .update(payloadBase64)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getNormalizedQrContextPayload({
  hotelSlug,
  tableNumber,
  orderSource = "qr",
  orderType = "dine-in"
} = {}) {
  const normalizedHotelSlug = normalizeQrContextText(hotelSlug, 120).toLowerCase();
  const normalizedTableNumber = normalizeQrContextText(tableNumber, 80);
  const normalizedOrderSource = normalizeQrContextText(orderSource, 40).toLowerCase() || "qr";
  const normalizedOrderType = normalizeQrContextText(orderType, 40).toLowerCase() || "dine-in";

  if (!normalizedHotelSlug || !normalizedTableNumber) {
    throw new Error("QR context requires hotel slug and table number");
  }

  return {
    v: 1,
    hotelSlug: normalizedHotelSlug,
    tableNumber: normalizedTableNumber,
    orderSource: normalizedOrderSource,
    orderType: normalizedOrderType,
    iat: new Date().toISOString()
  };
}

function buildQrContextToken(context = {}) {
  const payload = getNormalizedQrContextPayload(context);
  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signQrContextPayload(payloadBase64);

  return `${payloadBase64}.${signature}`;
}

function verifyQrContextToken(token = "") {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken || !normalizedToken.includes(".")) {
    return {
      valid: false,
      reason: "missing_or_malformed_token",
      payload: null
    };
  }

  const [payloadBase64, providedSignature] = normalizedToken.split(".", 2);

  if (!payloadBase64 || !providedSignature) {
    return {
      valid: false,
      reason: "missing_or_malformed_token",
      payload: null
    };
  }

  const expectedSignature = signQrContextPayload(payloadBase64);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return {
      valid: false,
      reason: "signature_mismatch",
      payload: null
    };
  }

  try {
    const parsedPayload = JSON.parse(fromBase64Url(payloadBase64).toString("utf8"));
    return {
      valid: true,
      reason: "verified",
      payload: getNormalizedQrContextPayload(parsedPayload)
    };
  } catch {
    return {
      valid: false,
      reason: "invalid_payload",
      payload: null
    };
  }
}

function resolveVerifiedQrOrderContext({
  hotelSlug = "",
  orderContext = null,
  strictRequired = env.qrContextStrictRequired
} = {}) {
  const normalizedHotelSlug = normalizeQrContextText(hotelSlug, 120).toLowerCase();
  const {
    orderContext: normalizedOrderContext,
    qrContextToken
  } = getNormalizedClientOrderContext(orderContext);

  if (qrContextToken) {
    const verification = verifyQrContextToken(qrContextToken);

    if (!verification.valid || !verification.payload) {
      return {
        ok: false,
        reason: verification.reason || "invalid_qr_context_token",
        message: "This QR table link is invalid. Please scan the table QR again.",
        orderContext: null,
        verified: false
      };
    }

    const verifiedContext = {
      orderType: verification.payload.orderType || "dine-in",
      tableNumber: verification.payload.tableNumber || "",
      orderSource: verification.payload.orderSource || "qr"
    };

    if (
      normalizedHotelSlug &&
      verification.payload.hotelSlug &&
      verification.payload.hotelSlug !== normalizedHotelSlug
    ) {
      return {
        ok: false,
        reason: "qr_context_hotel_mismatch",
        message: "This QR table link does not belong to this hotel.",
        orderContext: null,
        verified: false
      };
    }

    if (
      normalizedOrderContext?.tableNumber &&
      normalizedOrderContext.tableNumber !== verifiedContext.tableNumber
    ) {
      return {
        ok: false,
        reason: "qr_context_table_mismatch",
        message: "This QR table link was changed. Please scan the table QR again.",
        orderContext: null,
        verified: false
      };
    }

    return {
      ok: true,
      reason: "verified_qr_context",
      message: "",
      orderContext: verifiedContext,
      verified: true
    };
  }

  if (strictRequired && hasDineInQrContext(normalizedOrderContext)) {
    return {
      ok: false,
      reason: "signed_qr_context_required",
      message: "This QR table link must be regenerated. Please scan the latest hotel QR code.",
      orderContext: null,
      verified: false
    };
  }

  return {
    ok: true,
    reason: normalizedOrderContext ? "legacy_qr_context" : "no_qr_context",
    message: "",
    orderContext: normalizedOrderContext,
    verified: false
  };
}

module.exports = {
  buildQrContextToken,
  resolveVerifiedQrOrderContext,
  verifyQrContextToken
};
