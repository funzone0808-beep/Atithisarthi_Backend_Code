require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { env } = require("./config/env");
const logger = require("./utils/logger");
const {
  attachRequestContext,
  logRequestLifecycle
} = require("./middleware/request-observability");
const ordersRoute = require("./routes/orders");
const orderTrackingRoute = require("./routes/order-tracking");
const inquiriesRoute = require("./routes/inquiries");
const contactSubmissionsRoute = require("./routes/contact-submissions");
const reservationsRoute = require("./routes/reservations");
const testimonialsRoute = require("./routes/testimonials");
const adminRoute = require("./routes/admin");
const tenantRoute = require("./routes/tenant");
const publicRoute = require("./routes/public");
const publicAssistantRoute = require("./routes/public-assistant");
const authRoute = require("./routes/auth");
const staffRoute = require("./routes/staff");
const uploadRoute = require("./routes/upload");
const paymentsRoute = require("./routes/payments");
const paymentWebhooksRoute = require("./routes/payment-webhooks");

const app = express();
//const PORT = 5000;
const PORT = env.port;
app.set("trust proxy", 1);

app.use(attachRequestContext);
app.use(logRequestLifecycle);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value = "") {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalUrl(value = "") {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function buildReadinessCheck(name, ready, issue = "") {
  return {
    name,
    ready: !!ready,
    issue: ready ? "" : issue
  };
}

function getReadinessChecks() {
  const paymentEnabled = !!env.paymentGatewayEnabled;
  const paymentProvider = String(env.paymentGatewayProvider || "").trim().toLowerCase();
  const paymentProviderSupported = !paymentEnabled || paymentProvider === "razorpay";
  const paymentCredentialsReady = !paymentEnabled || (
    hasText(env.razorpayKeyId) &&
    hasText(env.razorpayKeySecret)
  );
  const paymentWebhookReady = !env.isProduction || !paymentEnabled || hasText(env.razorpayWebhookSecret);
  const paymentLiveKeyReady =
    !env.isProduction ||
    !paymentEnabled ||
    !String(env.razorpayKeyId || "").startsWith("rzp_test_");
  const emailNotificationReady =
    !env.notificationDeliveryEnabled ||
    String(env.notificationDeliveryChannel || "").trim().toLowerCase() !== "email" ||
    (
      hasText(env.notificationEmailFrom) &&
      hasText(env.notificationEmailTo) &&
      hasText(env.notificationSmtpHost) &&
      hasText(env.notificationSmtpUser) &&
      hasText(env.notificationSmtpPass)
    );

  return [
    buildReadinessCheck(
      "supabase_config",
      hasText(env.supabaseUrl) && hasText(env.supabaseServiceRoleKey),
      "missing_supabase_config"
    ),
    buildReadinessCheck(
      "jwt_secret",
      hasText(env.jwtSecret) && (!env.isProduction || env.jwtSecret.length >= 32),
      "weak_or_missing_jwt_secret"
    ),
    buildReadinessCheck(
      "frontend_origin",
      !env.isProduction || (isHttpsUrl(env.frontendUrl) && !isLocalUrl(env.frontendUrl)),
      "frontend_url_must_be_https_non_local"
    ),
    buildReadinessCheck(
      "admin_origin",
      !env.isProduction || (isHttpsUrl(env.adminUrl) && !isLocalUrl(env.adminUrl)),
      "admin_url_must_be_https_non_local"
    ),
    buildReadinessCheck(
      "payment_provider",
      paymentProviderSupported,
      "unsupported_payment_provider"
    ),
    buildReadinessCheck(
      "payment_credentials",
      paymentCredentialsReady,
      "missing_payment_credentials"
    ),
    buildReadinessCheck(
      "payment_webhook",
      paymentWebhookReady,
      "missing_payment_webhook_secret"
    ),
    buildReadinessCheck(
      "payment_live_key",
      paymentLiveKeyReady,
      "test_payment_key_in_production"
    ),
    buildReadinessCheck(
      "email_notifications",
      emailNotificationReady,
      "missing_email_notification_config"
    )
  ];
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later."
  }
});

// Security & parsing middleware (added here)
app.disable("x-powered-by");
app.use(helmet());
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  paymentWebhooksRoute
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const normalizeOrigin = (value = "") => String(value || "").trim().replace(/\/$/, "");
const parseOriginList = (value = "") =>
  String(value || "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);

const allowedOrigins = [
  env.frontendUrl,
  env.adminUrl,
  ...parseOriginList(env.frontendOrigins)
]
  .map(normalizeOrigin)
  .filter(Boolean)
  .filter((origin, index, list) => list.indexOf(origin) === index);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      logger.warn("Blocked by CORS", {
        origin: normalizedOrigin,
        allowedOrigins
      });

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: false
  })
);

app.use(globalLimiter);



// app.get("/api/health", (req, res) => {
//   res.json({
//     success: true,
//     message: "Backend is running"
//   });
// });

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend is running",
    env: env.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/readiness", (req, res) => {
  const checks = getReadinessChecks();
  const ready = checks.every((check) => check.ready);

  res.status(ready ? 200 : 503).json({
    success: ready,
    ready,
    env: env.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks
  });
});

app.use("/api/orders", ordersRoute);
app.use("/api/order-tracking", orderTrackingRoute);
app.use("/api/inquiries", inquiriesRoute);
app.use("/api/contact-submissions", contactSubmissionsRoute);
app.use("/api/reservations", reservationsRoute);
app.use("/api/testimonials", testimonialsRoute);
app.use("/api/admin", adminRoute);
app.use("/api/tenant", tenantRoute);
app.use("/api/public", publicRoute);
app.use("/api/public/assistant", publicAssistantRoute);
app.use("/api/auth", authRoute);
app.use("/api/staff/login", authLimiter);
app.use("/api/staff", staffRoute);
app.use("/api/payments", paymentsRoute);
app.use("/api/admin/upload", uploadRoute);

app.use((err, req, res, next) => {
  // console.error("Unhandled server error:", err);
logger.error("Unhandled server error", {
  message: err.message,
  stack: env.isDevelopment ? err.stack : undefined
});

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed"
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// app.listen(PORT, () => {
//   // console.log(`Server running on http://localhost:${PORT}`);
//   logger.info("Server started", {
//   port: PORT,
//   nodeEnv: env.nodeEnv
// });

// });

try {
  app.listen(PORT, () => {
    logger.info("Server started", {
      port: PORT,
      nodeEnv: env.nodeEnv
    });
  });
} catch (error) {
  logger.error("Server failed to start", {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
}
