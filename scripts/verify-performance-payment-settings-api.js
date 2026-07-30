"use strict";

const assert = require("assert").strict;
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const { supabase } = require("../utils/supabase");
const { signStaffToken } = require("../utils/auth");
const {
  fetchHotelFeatureConfig,
  isHotelFeatureEnabled
} = require("../utils/hotel-feature-settings");

const apiBase = String(
  process.env.PERFORMANCE_VERIFY_BASE_URL || "http://127.0.0.1:5000/api"
).replace(/\/$/, "");

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function authHeaders(token, extra = {}) {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    ...extra
  };
}

async function selectFoodEnabledStaff() {
  const { data, error } = await supabase
    .from("hotel_staff_access")
    .select("id,hotel_slug,display_name,role,kds_role,is_active")
    .eq("is_active", true);
  assert.ifError(error);

  const rows = data || [];
  const managers = rows.filter((row) =>
    String(row.role || "").trim().toLowerCase() === "owner"
  );
  let manager = null;
  for (const candidate of managers) {
    const features = await fetchHotelFeatureConfig(supabase, candidate.hotel_slug);
    if (isHotelFeatureEnabled(features, "food")) {
      manager = candidate;
      break;
    }
  }
  assert.ok(manager, "No active owner belongs to a food-enabled hotel");

  const basicStaff = rows.find((row) =>
    String(row.role || "").trim().toLowerCase() === "staff"
  );
  assert.ok(basicStaff, "No active ordinary Staff account is available for permission QA");
  return { manager, basicStaff, rows };
}

async function main() {
  const health = await fetchJson("/health");
  assert.strictEqual(health.response.status, 200, "Backend health endpoint is unavailable");

  const { manager, basicStaff, rows } = await selectFoodEnabledStaff();
  const managerToken = signStaffToken(manager);
  const basicStaffToken = signStaffToken(basicStaff);
  const otherHotel = rows.find((row) =>
    String(row.hotel_slug || "") && String(row.hotel_slug) !== String(manager.hotel_slug)
  )?.hotel_slug || "different-hotel-scope";

  const unauthenticated = await fetchJson("/staff/ordering-settings");
  assert.strictEqual(unauthenticated.response.status, 401, "Staff settings must require authentication");

  const managerRead = await fetchJson(
    `/staff/ordering-settings?hotelSlug=${encodeURIComponent(otherHotel)}`,
    { headers: authHeaders(managerToken) }
  );
  assert.strictEqual(managerRead.response.status, 200, "Manager settings read failed");
  assert.strictEqual(managerRead.body.success, true);
  assert.strictEqual(
    managerRead.body.hotelSlug,
    manager.hotel_slug,
    "Manager query string changed the signed-token hotel scope"
  );
  [
    "secureOnlinePaymentEnabled",
    "cashOnDeliveryEnabled",
    "manualUpiPaymentEnabled"
  ].forEach((key) => {
    assert.strictEqual(
      typeof managerRead.body.ordering?.[key],
      "boolean",
      `Manager settings response is missing boolean ${key}`
    );
  });
  assert.ok(managerRead.response.headers.get("x-request-id"), "Manager settings read lacks request ID");
  assert.match(
    managerRead.response.headers.get("server-timing") || "",
    /app;dur=/,
    "Manager settings read lacks Server-Timing"
  );

  const ordersRead = await fetchJson("/staff/orders?range=recent&limit=5", {
    headers: authHeaders(managerToken)
  });
  assert.strictEqual(ordersRead.response.status, 200, "Authenticated Orders summary read failed");
  assert.strictEqual(ordersRead.body.hotelSlug, manager.hotel_slug);
  assert.ok(Array.isArray(ordersRead.body.orders), "Orders response is not an array");
  ordersRead.body.orders.forEach((order) => {
    assert.strictEqual(order.hotelSlug, manager.hotel_slug, "Orders response crossed hotel scope");
  });
  assert.match(
    ordersRead.response.headers.get("server-timing") || "",
    /db;dur=/,
    "Orders response lacks accumulated database timing"
  );

  const staffPatchAttempt = await fetchJson("/staff/ordering-settings/payment-methods", {
    method: "PATCH",
    headers: authHeaders(basicStaffToken, { "content-type": "application/json" }),
    body: JSON.stringify({
      secureOnlinePaymentEnabled: true,
      cashOnDeliveryEnabled: true,
      manualUpiPaymentEnabled: true
    })
  });
  assert.strictEqual(staffPatchAttempt.response.status, 403, "Ordinary Staff changed payment settings");
  assert.strictEqual(
    staffPatchAttempt.body.code,
    "manager_access_required",
    "Ordinary Staff rejection code changed"
  );

  const adminAttempt = await fetchJson(
    `/admin/ordering-settings/${encodeURIComponent(manager.hotel_slug)}`,
    { headers: authHeaders(managerToken) }
  );
  assert.strictEqual(adminAttempt.response.status, 401, "Staff token accessed Platform Admin settings");

  console.log("Authenticated performance/payment API verification passed.");
  console.log(`Manager hotel scope verified: ${manager.hotel_slug}`);
  console.log(`Orders sampled: ${ordersRead.body.orders.length}`);
  console.log("Ordinary Staff mutation and Staff-to-Admin access were rejected before any write.");
  console.log("No successful mutation request was sent; no database writes were made by this verifier.");
}

main().catch((error) => {
  console.error(`Authenticated performance/payment API verification failed: ${error.message}`);
  process.exitCode = 1;
});
