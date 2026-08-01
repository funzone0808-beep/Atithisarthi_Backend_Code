"use strict";

const PUBLIC_ROUTE_CACHE_TTL_MS = 30 * 1000;
const publicRouteCache = new Map();

function getCachedPublicRoutePayload(cacheKey) {
  const cachedEntry = publicRouteCache.get(String(cacheKey || ""));

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    publicRouteCache.delete(String(cacheKey || ""));
    return null;
  }

  return cachedEntry.payload;
}

function setCachedPublicRoutePayload(cacheKey, payload) {
  publicRouteCache.set(String(cacheKey || ""), {
    expiresAt: Date.now() + PUBLIC_ROUTE_CACHE_TTL_MS,
    payload
  });
}

function invalidateCachedPublicRoutePrefix(prefix = "") {
  const normalizedPrefix = String(prefix || "").trim();
  if (!normalizedPrefix) return 0;
  let removed = 0;
  for (const cacheKey of publicRouteCache.keys()) {
    if (cacheKey.startsWith(normalizedPrefix)) {
      publicRouteCache.delete(cacheKey);
      removed += 1;
    }
  }
  return removed;
}

function invalidatePublicRoomsCache(hotelSlug = "") {
  const normalizedHotelSlug = String(hotelSlug || "").trim();
  if (!normalizedHotelSlug) return 0;
  return invalidateCachedPublicRoutePrefix(`rooms:${normalizedHotelSlug}:`);
}
function invalidatePublicTestimonialsCache(hotelSlug = "") {
  const normalizedHotelSlug = String(hotelSlug || "").trim();
  if (!normalizedHotelSlug) {
    return false;
  }

  return publicRouteCache.delete(`testimonials:${normalizedHotelSlug}`);
}
function invalidatePublicMenuCache(hotelSlug = "") {
  const normalizedHotelSlug = String(hotelSlug || "").trim();
  if (!normalizedHotelSlug) return false;
  return publicRouteCache.delete(`menu:${normalizedHotelSlug}`);
}

module.exports = {
  PUBLIC_ROUTE_CACHE_TTL_MS,
  getCachedPublicRoutePayload,
  invalidateCachedPublicRoutePrefix,
  invalidatePublicMenuCache,
  invalidatePublicRoomsCache,
  invalidatePublicTestimonialsCache,
  setCachedPublicRoutePayload
};
