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
  return `${req.baseUrl || ""}${req.path || ""}` || req.originalUrl?.split("?")[0] || "/";
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
      ip: getClientIp(req),
      origin: req.headers.origin || "",
      hotelHint: String(req.query?.hotel || req.query?.hotelSlug || "").trim()
    });
  });

  next();
}

module.exports = {
  attachRequestContext,
  logRequestLifecycle
};
