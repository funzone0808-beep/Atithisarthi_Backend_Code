const { supabase } = require("./supabase");
const { env } = require("../config/env");

const PUBLIC_HOTEL_ACCESS_CACHE_TTL_MS = 30 * 1000;
const PUBLIC_HOTEL_ACCESS_FIELDS = [
  "slug",
  "primary_domain",
  "subdomain",
  "is_active"
].join(",");
const publicHotelAccessCache = new Map();

function normalizePublicText(value = "", maxLength = 255) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function normalizePublicHostname(value = "") {
  const candidate = normalizePublicText(value, 2000);

  if (!candidate || candidate === "null") {
    return "";
  }

  try {
    const parsedUrl = new URL(candidate);
    return String(parsedUrl.hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return candidate
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");
  }
}

function isLocalPublicHostname(hostname = "") {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost")
  );
}

function parseConfiguredPublicHosts() {
  const configuredValues = [env.frontendUrl, env.frontendOrigins]
    .flatMap((value) => String(value || "").split(","))
    .map((value) => normalizePublicHostname(value))
    .filter(Boolean)
    .filter((hostname) => !isLocalPublicHostname(hostname));

  return [...new Set(configuredValues)];
}

function getTrustedPublicSubdomainParentHosts() {
  const parentHosts = new Set();

  parseConfiguredPublicHosts().forEach((hostname) => {
    const labels = hostname.split(".").filter(Boolean);

    if (labels.length >= 3) {
      parentHosts.add(labels.slice(1).join("."));
    }
  });

  return [...parentHosts];
}

function extractConfiguredSubdomainLabel(hostname = "") {
  const normalizedHostname = normalizePublicHostname(hostname);
  const labels = normalizedHostname.split(".").filter(Boolean);

  return labels.length >= 3 ? labels[0] : "";
}

function isTrustedConfiguredSubdomainHost(hostname = "") {
  const normalizedHostname = normalizePublicHostname(hostname);

  if (!normalizedHostname || isLocalPublicHostname(normalizedHostname)) {
    return false;
  }

  const labels = normalizedHostname.split(".").filter(Boolean);

  if (labels.length < 3) {
    return false;
  }

  const parentHost = labels.slice(1).join(".");

  return getTrustedPublicSubdomainParentHosts().includes(parentHost);
}

function getCachedPublicHotelAccess(cacheKey) {
  const cachedEntry = publicHotelAccessCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    publicHotelAccessCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.payload;
}

function setCachedPublicHotelAccess(cacheKey, payload) {
  publicHotelAccessCache.set(cacheKey, {
    expiresAt: Date.now() + PUBLIC_HOTEL_ACCESS_CACHE_TTL_MS,
    payload
  });
}

async function fetchPublicHotelAccess(slug = "") {
  const normalizedSlug = normalizePublicText(slug, 120).toLowerCase();

  if (!normalizedSlug) {
    return null;
  }

  const cacheKey = `hotel-access:${normalizedSlug}`;
  const cachedPayload = getCachedPublicHotelAccess(cacheKey);

  if (cachedPayload) {
    return cachedPayload;
  }

  const { data, error } = await supabase
    .from("hotels")
    .select(PUBLIC_HOTEL_ACCESS_FIELDS)
    .eq("slug", normalizedSlug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  setCachedPublicHotelAccess(cacheKey, data);
  return data;
}

function extractPublicRequestOriginHost(req) {
  const originHeader = normalizePublicText(req?.headers?.origin, 2000);
  const refererHeader = normalizePublicText(req?.headers?.referer, 2000);

  return (
    normalizePublicHostname(originHeader) ||
    normalizePublicHostname(refererHeader)
  );
}

function doesOriginMatchHotel(originHost = "", hotel = {}) {
  const normalizedOriginHost = normalizePublicHostname(originHost);

  if (!normalizedOriginHost || isLocalPublicHostname(normalizedOriginHost)) {
    return true;
  }

  const primaryDomain = normalizePublicHostname(hotel.primary_domain || "");
  const subdomain = normalizePublicText(hotel.subdomain || "", 120).toLowerCase();

  if (!primaryDomain && !subdomain) {
    return true;
  }

  if (primaryDomain && normalizedOriginHost === primaryDomain) {
    return true;
  }

  if (
    subdomain &&
    isTrustedConfiguredSubdomainHost(normalizedOriginHost) &&
    extractConfiguredSubdomainLabel(normalizedOriginHost) === subdomain
  ) {
    return true;
  }

  return false;
}

async function ensurePublicHotelAccess(req, res, slug = "", options = {}) {
  const normalizedOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const notFoundMessage =
    normalizePublicText(normalizedOptions.notFoundMessage, 160) ||
    "Hotel is not publicly available";
  const forbiddenMessage =
    normalizePublicText(normalizedOptions.forbiddenMessage, 200) ||
    "This hotel content is not available for the current origin";
  const hotelAccess = await fetchPublicHotelAccess(slug);

  if (!hotelAccess || hotelAccess.is_active !== true) {
    res.status(404).json({
      success: false,
      message: notFoundMessage
    });
    return null;
  }

  const originHost = extractPublicRequestOriginHost(req);

  if (!doesOriginMatchHotel(originHost, hotelAccess)) {
    res.status(403).json({
      success: false,
      message: forbiddenMessage
    });
    return null;
  }

  return hotelAccess;
}

module.exports = {
  doesOriginMatchHotel,
  ensurePublicHotelAccess,
  extractPublicRequestOriginHost,
  fetchPublicHotelAccess,
  extractConfiguredSubdomainLabel,
  isLocalPublicHostname,
  isTrustedConfiguredSubdomainHost,
  getTrustedPublicSubdomainParentHosts,
  normalizePublicHostname,
  normalizePublicText
};
