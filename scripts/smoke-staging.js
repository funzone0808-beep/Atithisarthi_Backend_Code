"use strict";

const assert = require("assert");
const baseUrl = String(process.env.SMOKE_BASE_URL || "").trim().replace(/\/$/, "");
const hotelSlug = String(process.env.SMOKE_HOTEL_SLUG || "").trim();
const expectedEnvironment = String(process.env.SMOKE_EXPECTED_ENV || "staging").trim().toLowerCase();
const productionHosts = String(process.env.PRODUCTION_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);

function refuseUnsafeTarget() {
  if (!baseUrl || !hotelSlug) throw new Error("SMOKE_BASE_URL and SMOKE_HOTEL_SLUG are required");
  const url = new URL(baseUrl);
  if (productionHosts.includes(url.hostname.toLowerCase())) throw new Error("Smoke suite refused a host listed in PRODUCTION_HOSTS");
  if (!/(staging|stage|localhost|127\.0\.0\.1)/i.test(url.hostname) && process.env.ALLOW_NON_STAGING_SMOKE !== "yes") {
    throw new Error("Smoke suite requires an identifiable staging/local host; set ALLOW_NON_STAGING_SMOKE=yes only for an approved isolated target");
  }
}

async function request(route, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
  assert.ok(expectedStatuses.includes(response.status), `${route} returned ${response.status}, expected ${expectedStatuses.join("/")}`);
  return response;
}

async function main() {
  refuseUnsafeTarget();
  const checks = [];
  async function check(name, task) { await task(); checks.push(name); console.log(`PASS ${name}`); }
  await check("health", async () => {
    const response = await request("/health");
    const body = await response.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(String(body.env || "").toLowerCase(), expectedEnvironment);
  });
  await check("readiness", () => request("/readiness"));
  await check("public hotel", () => request(`/public/hotel/${encodeURIComponent(hotelSlug)}`));
  await check("public menu", () => request(`/public/menu/${encodeURIComponent(hotelSlug)}`));
  await check("public rooms", () => request(`/public/rooms/${encodeURIComponent(hotelSlug)}`));
  await check("admin rejects anonymous", () => request(process.env.SMOKE_ADMIN_PATH || "/admin/hotels", [401, 403]));
  await check("staff rejects anonymous", () => request(process.env.SMOKE_STAFF_PATH || "/staff/orders", [401, 403]));
  console.log(`Staging smoke suite passed: ${checks.length}/${checks.length}`);
}

main().catch((error) => {
  console.error(`Staging smoke suite failed: ${error.message}`);
  process.exitCode = 1;
});
