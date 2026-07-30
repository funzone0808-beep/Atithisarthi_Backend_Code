const {
  normalizePublicHostname,
  normalizePublicText
} = require("./public-hotel-access");

const SUBDOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeHotelPrimaryDomainInput(value = "") {
  return normalizePublicHostname(value);
}

function normalizeHotelSubdomainInput(value = "") {
  return normalizePublicText(value, 255)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateHotelDomainSettings({
  primaryDomain = undefined,
  subdomain = undefined
} = {}) {
  const rawSubdomain =
    subdomain === undefined
      ? undefined
      : normalizePublicText(subdomain, 255);
  const normalizedPrimaryDomain =
    primaryDomain === undefined
      ? undefined
      : normalizeHotelPrimaryDomainInput(primaryDomain);
  const normalizedSubdomain =
    subdomain === undefined
      ? undefined
      : normalizeHotelSubdomainInput(subdomain);

  if (normalizedPrimaryDomain !== undefined) {
    if (
      normalizedPrimaryDomain &&
      (
        normalizedPrimaryDomain.length > 255 ||
        !normalizedPrimaryDomain.includes(".") ||
        normalizedPrimaryDomain === "localhost" ||
        normalizedPrimaryDomain === "127.0.0.1" ||
        normalizedPrimaryDomain === "0.0.0.0"
      )
    ) {
      return {
        ok: false,
        message: "Primary domain must be a real public hostname like example.com"
      };
    }
  }

  if (normalizedSubdomain !== undefined) {
    if (
      rawSubdomain &&
      !normalizedSubdomain
    ) {
      return {
        ok: false,
        message: "Subdomain can use lowercase letters, numbers, and hyphens only"
      };
    }

    if (
      normalizedSubdomain &&
      (
        normalizedSubdomain.length > 63 ||
        !SUBDOMAIN_PATTERN.test(normalizedSubdomain)
      )
    ) {
      return {
        ok: false,
        message: "Subdomain can use lowercase letters, numbers, and hyphens only"
      };
    }
  }

  return {
    ok: true,
    values: {
      primaryDomain:
        normalizedPrimaryDomain === undefined
          ? undefined
          : normalizedPrimaryDomain || null,
      subdomain:
        normalizedSubdomain === undefined
          ? undefined
          : normalizedSubdomain || null
    }
  };
}

async function findHotelDomainConflict(supabase, {
  hotelId = "",
  primaryDomain = undefined,
  subdomain = undefined
} = {}) {
  const normalizedHotelId = String(hotelId || "").trim();
  const normalizedPrimaryDomain = normalizeHotelPrimaryDomainInput(primaryDomain || "");
  const normalizedSubdomain = normalizeHotelSubdomainInput(subdomain || "");
  const selectColumns = "id,slug,name,primary_domain,subdomain";

  if (normalizedPrimaryDomain) {
    const { data, error } = await supabase
      .from("hotels")
      .select(selectColumns)
      .eq("primary_domain", normalizedPrimaryDomain)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data && String(data.id) !== normalizedHotelId) {
      return {
        field: "primaryDomain",
        message: `Primary domain is already assigned to ${data.name || data.slug || "another hotel"}`
      };
    }
  }

  if (normalizedSubdomain) {
    const { data, error } = await supabase
      .from("hotels")
      .select(selectColumns)
      .eq("subdomain", normalizedSubdomain)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data && String(data.id) !== normalizedHotelId) {
      return {
        field: "subdomain",
        message: `Subdomain is already assigned to ${data.name || data.slug || "another hotel"}`
      };
    }
  }

  return null;
}

module.exports = {
  findHotelDomainConflict,
  normalizeHotelPrimaryDomainInput,
  normalizeHotelSubdomainInput,
  validateHotelDomainSettings
};
