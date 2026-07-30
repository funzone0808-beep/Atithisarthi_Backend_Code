require("dotenv").config({ path: ".env" });

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const publicRoutesPath = path.join(projectRoot, "backend", "routes", "public.js");
const publicHotelAccessPath = path.join(projectRoot, "backend", "utils", "public-hotel-access.js");
const tenantRoutesPath = path.join(projectRoot, "backend", "routes", "tenant.js");

function readFileOrExit(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.log(`Tenant/domain trust check failed: could not read ${label}.`);
    console.log(error.message || String(error));
    process.exit(1);
  }
}

function hasPattern(content, pattern) {
  return pattern.test(content);
}

function normalizeHostname(value = "") {
  const candidate = String(value || "").trim();

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

function isLocalHostname(hostname = "") {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost")
  );
}

function parseConfiguredPublicHosts() {
  return [process.env.FRONTEND_URL, process.env.FRONTEND_ORIGINS]
    .flatMap((value) => String(value || "").split(","))
    .map((value) => normalizeHostname(value))
    .filter(Boolean)
    .filter((hostname) => !isLocalHostname(hostname))
    .filter((hostname, index, list) => list.indexOf(hostname) === index);
}

function getTrustedParentHosts(hosts = []) {
  return hosts
    .map((hostname) => hostname.split(".").filter(Boolean))
    .filter((labels) => labels.length >= 3)
    .map((labels) => labels.slice(1).join("."))
    .filter((hostname, index, list) => list.indexOf(hostname) === index);
}

function main() {
  const publicRoutesSource = readFileOrExit(publicRoutesPath, "public routes");
  const publicHotelAccessSource = readFileOrExit(publicHotelAccessPath, "public hotel access util");
  const tenantRoutesSource = readFileOrExit(tenantRoutesPath, "tenant routes");
  const configuredPublicHosts = parseConfiguredPublicHosts();
  const trustedParentHosts = getTrustedParentHosts(configuredPublicHosts);
  const failures = [];
  const warnings = [];

  if (
    !hasPattern(
      publicRoutesSource,
      /const\s*\{(?:(?!\}\s*=\s*require)[\s\S])*?ensurePublicHotelAccess(?:(?!\}\s*=\s*require)[\s\S])*?\}\s*=\s*require\("\.\.\/utils\/public-hotel-access"\);/m
    )
  ) {
    failures.push("public.js is not importing ensurePublicHotelAccess from the shared public-hotel-access util");
  }

  if (
    hasPattern(
      publicRoutesSource,
      /function\s+doesOriginMatchHotel\s*\(/m
    )
  ) {
    failures.push("public.js still contains a duplicate doesOriginMatchHotel implementation");
  }

  [
    {
      label: "shared trusted subdomain host helper",
      pattern: /function\s+isTrustedConfiguredSubdomainHost\s*\(/m
    },
    {
      label: "shared configured subdomain label helper",
      pattern: /function\s+extractConfiguredSubdomainLabel\s*\(/m
    },
    {
      label: "shared trusted public parent host helper",
      pattern: /function\s+getTrustedPublicSubdomainParentHosts\s*\(/m
    }
  ].forEach((check) => {
    if (!hasPattern(publicHotelAccessSource, check.pattern)) {
      failures.push(`${check.label} is missing from public-hotel-access.js`);
    }
  });

  if (
    !hasPattern(
      publicHotelAccessSource,
      /if\s*\(\s*subdomain\s*&&\s*isTrustedConfiguredSubdomainHost\(normalizedOriginHost\)\s*&&\s*extractConfiguredSubdomainLabel\(normalizedOriginHost\)\s*===\s*subdomain\s*\)/m
    )
  ) {
    failures.push("public-hotel-access.js is not gating subdomain origin matches through the trusted configured parent-host check");
  }

  if (
    !hasPattern(
      tenantRoutesSource,
      /const\s*\{\s*extractConfiguredSubdomainLabel,\s*isTrustedConfiguredSubdomainHost,\s*normalizePublicHostname,\s*resolveConfiguredTenantHostAlias\s*\}\s*=\s*require\("\.\.\/utils\/public-hotel-access"\);/m
    )
  ) {
    failures.push("tenant.js is not importing the shared hostname trust helpers from public-hotel-access.js");
  }

  if (
    !hasPattern(
      tenantRoutesSource,
      /const\s+subdomainPart\s*=\s*isTrustedConfiguredSubdomainHost\(normalizedHost\)\s*\?\s*extractConfiguredSubdomainLabel\(normalizedHost\)\s*:\s*"";/m
    )
  ) {
    failures.push("tenant.js subdomain fallback is not protected by the trusted configured parent-host check");
  }

  if (!configuredPublicHosts.length) {
    warnings.push("No non-local FRONTEND_URL / FRONTEND_ORIGINS hosts are configured. Exact primary-domain matching can still work, but trusted shared subdomain routing cannot be validated from env yet.");
  }

  if (!trustedParentHosts.length && configuredPublicHosts.length) {
    warnings.push("No shared public parent domains were derived from FRONTEND_URL / FRONTEND_ORIGINS. Exact primary domains can still work, but subdomain-based tenant routing will not be trusted until at least one configured public host includes a subdomain.");
  }

  if (failures.length) {
    console.log("Tenant/domain trust check failed.");
    failures.forEach((failure) => {
      console.log(`- ${failure}`);
    });

    if (warnings.length) {
      console.log("Warnings:");
      warnings.forEach((warning) => {
        console.log(`- ${warning}`);
      });
    }

    process.exit(1);
  }

  console.log("Tenant/domain trust guard looks ready.");
  console.log(`Configured public hosts: ${configuredPublicHosts.length ? configuredPublicHosts.join(", ") : "none"}`);
  console.log(`Trusted shared parent domains: ${trustedParentHosts.length ? trustedParentHosts.join(", ") : "none"}`);

  if (warnings.length) {
    console.log("Warnings:");
    warnings.forEach((warning) => {
      console.log(`- ${warning}`);
    });
  }
}

main();
