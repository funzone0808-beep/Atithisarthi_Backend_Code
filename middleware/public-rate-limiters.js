const rateLimit = require("express-rate-limit");

function normalizeLimiterText(value = "", maxLength = 120) {
  return typeof value === "string"
    ? value.trim().toLowerCase().slice(0, maxLength)
    : "";
}

function getPublicHotelSlug(req = {}) {
  return normalizeLimiterText(
    req?.body?.hotelSlug ||
      req?.validatedBody?.hotelSlug ||
      req?.params?.slug ||
      "",
    120
  );
}

function buildPublicHotelRateLimitKey(scope = "public-write") {
  const normalizedScope = normalizeLimiterText(scope, 60) || "public-write";

  return function getPublicHotelRateLimitKey(req = {}) {
    const hotelSlug = getPublicHotelSlug(req) || "unknown-hotel";
    const normalizedIp = req.ip
      ? rateLimit.ipKeyGenerator(req.ip)
      : "unknown-ip";

    return `${normalizedScope}:${normalizedIp}:${hotelSlug}`;
  };
}

function createPublicLimiter({
  scope,
  windowMs,
  limit,
  message
}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: buildPublicHotelRateLimitKey(scope),
    message: {
      success: false,
      message
    }
  });
}

const publicOrderLimiter = createPublicLimiter({
  scope: "public-order-create",
  windowMs: 10 * 60 * 1000,
  limit: 40,
  message: "Too many order attempts. Please wait a moment and try again."
});

const publicPaymentInitLimiter = createPublicLimiter({
  scope: "public-payment-init",
  windowMs: 10 * 60 * 1000,
  limit: 25,
  message: "Too many payment attempts. Please wait a moment and try again."
});

const publicReservationLimiter = createPublicLimiter({
  scope: "public-reservation-create",
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many reservation requests. Please wait a moment and try again."
});

const publicInquiryLimiter = createPublicLimiter({
  scope: "public-inquiry-create",
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many inquiry requests. Please wait a moment and try again."
});

const publicContactSubmissionLimiter = createPublicLimiter({
  scope: "public-contact-create",
  windowMs: 15 * 60 * 1000,
  limit: 8,
  message: "Too many contact requests. Please wait a moment and try again."
});

const publicTestimonialSubmissionLimiter = createPublicLimiter({
  scope: "public-testimonial-create",
  windowMs: 30 * 60 * 1000,
  limit: 6,
  message: "Too many review submissions. Please wait a while and try again."
});

const publicAssistantLimiter = createPublicLimiter({
  scope: "public-menu-assistant",
  windowMs: 5 * 60 * 1000,
  limit: 20,
  message: "Too many assistant requests. Please wait a moment and try again."
});

module.exports = {
  publicAssistantLimiter,
  publicContactSubmissionLimiter,
  publicInquiryLimiter,
  publicOrderLimiter,
  publicPaymentInitLimiter,
  publicReservationLimiter,
  publicTestimonialSubmissionLimiter
};
