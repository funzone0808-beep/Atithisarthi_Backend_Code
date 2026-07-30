const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const includes = (source, value) => assert.ok(source.includes(value), `Missing KDS contract: ${value}`);

const transitions = { new: ["accepted", "preparing"], accepted: ["preparing", "delayed"], preparing: ["ready", "delayed"], delayed: ["preparing", "ready"], ready: ["served"], served: [], cancelled: [] };
assert.ok(transitions.new.includes("preparing") && transitions.ready.includes("served"));
assert.ok(!transitions.ready.includes("preparing") && !transitions.new.includes("served"));

const html = read("frontend/staff-orders.html");
const frontend = read("frontend/js/staff-orders.js");
const route = read("backend/routes/staff.js");
const auth = read("backend/utils/auth.js");
const validator = read("backend/validators/staff.js");
const migration = read("backend/scripts/upgrade-production-kds-workflow.sql");
const rounds = read("backend/scripts/create-active-order-item-rounds.sql");
["staffKdsViewModeInput", "staffKdsSourceInput", "staffKdsAddedItemsToggle", "staffFullscreenToggleBtn", "staffKitchenDisplayClock", "grid-template-columns: repeat(3", "@media (max-width: 600px)"].forEach((v) => includes(html, v));
["STAFF_KDS_BOARD_COLUMNS", "getStaffKdsBoardStage", "getStaffKdsAllowedActions", "kdsServerClockOffsetMs", "data-staff-kds-created-at", "kdsRenderSignature", "playSound: true", 'includeServed: "false"', 'window.addEventListener("offline"'].forEach((v) => includes(frontend, v));
["STAFF_KDS_STATUS_TRANSITIONS", "isValidStaffKdsTransition", "canStaffPerformKdsTransition", 'eq("hotel_slug", hotelSlug)', 'eq("order_version", currentVersion)', 'code: "KDS_TICKET_CHANGED"', "serverTime", "capabilities"].forEach((v) => includes(route, v));
["normalizeStaffKdsRole", "kdsRole", "STAFF_KDS_ROLES"].forEach((v) => includes(auth, v));
includes(validator, "expectedVersion: z.number().int().positive()");
["kds_settings", "kitchen_stations", "kds_status_history", "kds_role", "idx_orders_kds_active_hotel_status_created"].forEach((v) => includes(migration, v));
includes(rounds, "v_round_items");
assert.ok(!frontend.includes("window.location.reload()"));
["frontend/js/staff-orders.js", "backend/routes/staff.js", "backend/utils/auth.js", "backend/middleware/require-staff-auth.js", "backend/validators/staff.js"].forEach((file) => execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" }));

async function verifyLiveSchema() {
  require("dotenv").config({ path: path.join(root, "backend", ".env"), quiet: true });
  const { supabase } = require("../utils/supabase");
  const probes = [
    ["hotel_staff_access", "id,hotel_slug,kds_role"],
    ["kds_settings", "hotel_slug,default_view,attention_minutes,delayed_minutes,critical_minutes"],
    ["kitchen_stations", "id,hotel_slug,station_code,station_name,is_active"],
    ["kds_status_history", "id,hotel_slug,order_id,from_status,to_status,created_at"],
    ["orders", "id,hotel_slug,kitchen_status,order_version"],
    ["order_rounds", "id,hotel_slug,order_id,status,row_version,items"]
  ];
  for (const [table, columns] of probes) {
    const result = await supabase.from(table).select(columns, { count: "exact" }).limit(5);
    assert.ifError(result.error);
    console.log(`LIVE ${table}: OK (${Number(result.count || 0)} rows)`);
  }

  const staffHotelsResult = await supabase.from("hotel_staff_access").select("hotel_slug").eq("is_active", true);
  assert.ifError(staffHotelsResult.error);
  const stationResult = await supabase.from("kitchen_stations").select("hotel_slug,station_code,is_active").eq("station_code", "main").eq("is_active", true);
  assert.ifError(stationResult.error);
  const expectedHotels = new Set((staffHotelsResult.data || []).map((row) => String(row.hotel_slug || "").trim()).filter(Boolean));
  const stationHotels = new Set((stationResult.data || []).map((row) => String(row.hotel_slug || "").trim()).filter(Boolean));
  expectedHotels.forEach((hotelSlug) => assert.ok(stationHotels.has(hotelSlug), `Missing active Main Kitchen station for ${hotelSlug}`));
  console.log(`LIVE Main Kitchen defaults: OK (${stationHotels.size} hotels)`);
}

async function verifyAuthenticatedKdsRead() {
  require("dotenv").config({ path: path.join(root, "backend", ".env"), quiet: true });
  const { supabase } = require("../utils/supabase");
  const { signStaffToken, normalizeStaffKdsRole } = require("../utils/auth");
  const {
    fetchHotelFeatureConfig,
    isHotelFeatureEnabled
  } = require("../utils/hotel-feature-settings");

  const staffResult = await supabase
    .from("hotel_staff_access")
    .select("id,hotel_slug,display_name,role,kds_role,is_active")
    .eq("is_active", true);
  assert.ifError(staffResult.error);

  const candidates = (staffResult.data || []).sort((left, right) => {
    const leftIsBasicStaff = String(left.role || "").trim().toLowerCase() === "staff" ? 0 : 1;
    const rightIsBasicStaff = String(right.role || "").trim().toLowerCase() === "staff" ? 0 : 1;
    return leftIsBasicStaff - rightIsBasicStaff;
  });
  let selectedStaff = null;
  for (const candidate of candidates) {
    const featureConfig = await fetchHotelFeatureConfig(supabase, candidate.hotel_slug);
    if (isHotelFeatureEnabled(featureConfig, "food")) {
      selectedStaff = candidate;
      break;
    }
  }
  assert.ok(selectedStaff, "No active staff account belongs to a food-enabled hotel");

  const baseUrl = new URL(
    process.env.KDS_VERIFY_BASE_URL || "http://127.0.0.1:5000"
  );
  const endpoint = new URL("/api/staff/kds/orders?includeServed=false&includeCancelled=false&limit=50", baseUrl);
  const token = signStaffToken(selectedStaff);
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await response.json();

  assert.strictEqual(response.status, 200, `Authenticated KDS read returned HTTP ${response.status}`);
  assert.strictEqual(payload.success, true);
  assert.strictEqual(payload.hotelSlug, selectedStaff.hotel_slug);
  assert.ok(Number.isFinite(Date.parse(payload.serverTime)), "KDS response serverTime is invalid");
  assert.ok(Number(payload.refreshAfterMs) > 0, "KDS response refreshAfterMs is invalid");
  assert.ok(Array.isArray(payload.orders), "KDS response orders must be an array");
  assert.strictEqual(Number(payload.count), payload.orders.length);

  const expectedRole = normalizeStaffKdsRole(selectedStaff.kds_role, selectedStaff.role);
  assert.strictEqual(payload.capabilities?.role, expectedRole);
  ["canPrepare", "canServe", "canManage"].forEach((key) => {
    assert.strictEqual(typeof payload.capabilities?.[key], "boolean", `KDS capability ${key} must be boolean`);
  });
  payload.orders.forEach((order) => {
    ["customerName", "customerPhone", "customerEmail", "paymentReference", "paymentMethod", "total", "subtotal"]
      .forEach((key) => assert.ok(!(key in order), `KDS response exposed restricted field: ${key}`));
  });

  const crypto = require("crypto");
  const invalidOrderId = crypto.randomUUID();
  const missingOrderId = "9223372036854775807";
  const requestBody = JSON.stringify({
    kitchenStatus: "preparing",
    expectedVersion: 1,
    clientRequestId: crypto.randomUUID()
  });
  const requestHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  const invalidOrderProbe = await fetch(
    new URL(`/api/staff/kds/orders/${invalidOrderId}/kitchen-status`, baseUrl),
    {
      method: "PATCH",
      headers: requestHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(10_000)
    }
  );
  const invalidOrderPayload = await invalidOrderProbe.json();
  assert.strictEqual(
    invalidOrderProbe.status,
    400,
    `Malformed-order KDS status probe returned HTTP ${invalidOrderProbe.status}`
  );
  assert.strictEqual(invalidOrderPayload.code, "INVALID_ORDER_ID");

  const orderStatusProbe = await fetch(
    new URL(`/api/staff/kds/orders/${missingOrderId}/kitchen-status`, baseUrl),
    {
      method: "PATCH",
      headers: requestHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(10_000)
    }
  );
  const orderStatusPayload = await orderStatusProbe.json();
  assert.strictEqual(
    orderStatusProbe.status,
    404,
    `Nonexistent-order KDS status probe returned HTTP ${orderStatusProbe.status}`
  );
  assert.strictEqual(orderStatusPayload.success, false);

  const roundStatusProbe = await fetch(
    new URL(`/api/staff/kds/orders/${missingOrderId}/rounds/2/kitchen-status`, baseUrl),
    {
      method: "PATCH",
      headers: requestHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(10_000)
    }
  );
  const roundStatusPayload = await roundStatusProbe.json();
  assert.strictEqual(
    roundStatusProbe.status,
    404,
    `Nonexistent-round KDS status probe returned HTTP ${roundStatusProbe.status}`
  );
  assert.strictEqual(roundStatusPayload.code, "ROUND_NOT_FOUND");

  console.log(
    `AUTH KDS read/routes: OK (${payload.orders.length} active tickets, role=${expectedRole}, privacy=OK, write-scope=OK)`
  );
}

async function main() {
  if (process.argv.includes("--live")) await verifyLiveSchema();
  if (process.argv.includes("--auth-read")) await verifyAuthenticatedKdsRead();
  console.log("Production KDS verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

