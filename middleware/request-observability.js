const crypto = require("crypto");
const logger = require("../utils/logger");

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getRequestId(req) {
  const headerValue = req.headers["x-request-id"];

  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  if (Array.isArray(headerValue)) {
    const firstHeaderValue = String(headerValue[0] || "").trim();
    if (firstHeaderValue) return firstHeaderValue;
  }

  return createRequestId();
}

function getSafePath(req) {
  const path = `${req.baseUrl || ""}${req.path || ""}` || req.originalUrl?.split("?")[0] || "/";
  return path
    .replace(/(\/api\/public\/qr\/)[^/]+(?=\/(?:context|session|orders)(?:\/|$))/gi, "$1[redacted]")
    .replace(/([?&](?:q|qctx|qrContextToken)=)[^&]+/gi, "$1[redacted]");
}

function getClientIp(req) {
  const forwardedForHeader = req.headers["x-forwarded-for"];

  if (typeof forwardedForHeader === "string" && forwardedForHeader.trim()) {
    return forwardedForHeader.split(",")[0].trim();
  }

  if (Array.isArray(forwardedForHeader) && forwardedForHeader.length) {
    return String(forwardedForHeader[0] || "").split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "";
}

function getRequestLogLevel(statusCode) {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

function shouldSkipRequestLog(req = {}) {
  const path = getSafePath(req);
  return path === "/api/health" || path === "/api/readiness";
}

function attachRequestContext(req, res, next) {
  const requestId = getRequestId(req);

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  next();
}

function logRequestLifecycle(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const originalWriteHead = res.writeHead;

  res.writeHead = function writeHeadWithServerTiming(...args) {
    if (!res.headersSent) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const timingEntries = [`app;dur=${durationMs.toFixed(2)}`];
      const dbDurationMs = Number(res.locals?.dbDurationMs);
      if (Number.isFinite(dbDurationMs) && dbDurationMs >= 0) {
        timingEntries.push(`db;dur=${dbDurationMs.toFixed(2)}`);
      }
      res.setHeader("server-timing", timingEntries.join(", "));
    }

    return originalWriteHead.apply(this, args);
  };

  res.on("finish", () => {
    if (shouldSkipRequestLog(req)) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const logLevel = getRequestLogLevel(res.statusCode);
    const logMessage =
      res.statusCode >= 500
        ? "Request failed"
        : res.statusCode >= 400
          ? "Request completed with client error"
          : "Request completed";

    logger[logLevel](logMessage, {
      requestId: req.requestId || "",
      method: req.method || "",
      path: getSafePath(req),
      statusCode: res.statusCode || 0,
      durationMs: Number(durationMs.toFixed(2)),
      dbDurationMs: Number.isFinite(Number(res.locals?.dbDurationMs))
        ? Number(Number(res.locals.dbDurationMs).toFixed(2))
        : undefined,
      responseBytes: Number(res.getHeader("content-length") || 0) || undefined,
      ip: getClientIp(req),
      origin: req.headers.origin || "",
      hotelHint: String(req.staffHotelSlug || req.query?.hotel || req.query?.hotelSlug || "").trim()
    });
  });

  next();
}

module.exports = {
  attachRequestContext,
  logRequestLifecycle
};
