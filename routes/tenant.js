const express = require("express");
const { supabase } = require("../utils/supabase");
const {
  extractConfiguredSubdomainLabel,
  isTrustedConfiguredSubdomainHost,
  normalizePublicHostname
} = require("../utils/public-hotel-access");

const router = express.Router();
const TENANT_RESOLVE_CACHE_CONTROL = "public, max-age=120, stale-while-revalidate=600";
const TENANT_RESOLVE_CACHE_TTL_MS = 2 * 60 * 1000;
const tenantResolveCache = new Map();

const PUBLIC_TENANT_FIELDS = [
  "slug",
  "name",
  "primary_domain",
  "subdomain",
  "is_active"
].join(",");

function getCachedTenantResolvePayload(cacheKey) {
  const cachedEntry = tenantResolveCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    tenantResolveCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.payload;
}

function setCachedTenantResolvePayload(cacheKey, payload) {
  tenantResolveCache.set(cacheKey, {
    expiresAt: Date.now() + TENANT_RESOLVE_CACHE_TTL_MS,
    payload
  });
}

/*
  GET /api/tenant/resolve?host=example.com
  Returns hotel record matching:
  - primary_domain
  - or subdomain
*/
router.get("/resolve", async (req, res) => {
  try {
    const host = String(req.query.host || "").trim().toLowerCase();

    if (!host) {
      return res.status(400).json({
        success: false,
        message: "Host is required"
      });
    }

    const normalizedHost = normalizePublicHostname(host);
    const cacheKey = `resolve:${normalizedHost}`;
    const cachedPayload = getCachedTenantResolvePayload(cacheKey);

    if (cachedPayload) {
      res.set("Cache-Control", TENANT_RESOLVE_CACHE_CONTROL);
      return res.json(cachedPayload);
    }

    // First try exact primary domain match
    let { data, error } = await supabase
      .from("hotels")
      .select(PUBLIC_TENANT_FIELDS)
      .eq("primary_domain", normalizedHost)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;

    // If not found, try subdomain match against first hostname label
    if (!data) {
      const subdomainPart =
        isTrustedConfiguredSubdomainHost(normalizedHost)
          ? extractConfiguredSubdomainLabel(normalizedHost)
          : "";

      if (subdomainPart) {
        const subdomainResult = await supabase
          .from("hotels")
          .select(PUBLIC_TENANT_FIELDS)
          .eq("subdomain", subdomainPart)
          .eq("is_active", true)
          .maybeSingle();

        if (subdomainResult.error) throw subdomainResult.error;
        data = subdomainResult.data;
      }
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "No hotel found for this host"
      });
    }

    const payload = {
      success: true,
      hotel: data
    };

    setCachedTenantResolvePayload(cacheKey, payload);
    res.set("Cache-Control", TENANT_RESOLVE_CACHE_CONTROL);
    res.json(payload);
  } catch (error) {
    console.error("Tenant resolve error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resolve tenant"
    });
  }
});

module.exports = router;
