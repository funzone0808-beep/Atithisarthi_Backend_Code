const express = require("express");
const { supabase } = require("../utils/supabase");

const router = express.Router();

const PUBLIC_TENANT_FIELDS = [
  "slug",
  "name",
  "primary_domain",
  "subdomain",
  "is_active"
].join(",");

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

    const normalizedHost = host.replace(/^www\./, "");

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
      const subdomainPart = normalizedHost.split(".")[0];

      const subdomainResult = await supabase
        .from("hotels")
        .select(PUBLIC_TENANT_FIELDS)
        .eq("subdomain", subdomainPart)
        .eq("is_active", true)
        .maybeSingle();

      if (subdomainResult.error) throw subdomainResult.error;
      data = subdomainResult.data;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "No hotel found for this host"
      });
    }

    res.json({
      success: true,
      hotel: data
    });
  } catch (error) {
    console.error("Tenant resolve error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resolve tenant"
    });
  }
});

module.exports = router;
