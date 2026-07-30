const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
require("dotenv").config({ path: path.join(root, "backend", ".env"), quiet: true });

const { supabase } = require("../utils/supabase");
const { signStaffToken } = require("../utils/auth");
const {
  fetchHotelFeatureConfig,
  isHotelFeatureEnabled
} = require("../utils/hotel-feature-settings");

const baseUrl = new URL(
  process.env.TAKE_ORDER_VERIFY_BASE_URL || "http://127.0.0.1:5000"
);

async function fetchJson(pathname, token) {
  const response = await fetch(new URL(pathname, baseUrl), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function getFoodEnabledStaff() {
  const result = await supabase
    .from("hotel_staff_access")
    .select("id,hotel_slug,display_name,role,kds_role,is_active")
    .eq("is_active", true);
  assert.ifError(result.error);

  const enabled = [];
  for (const staff of result.data || []) {
    const featureConfig = await fetchHotelFeatureConfig(supabase, staff.hotel_slug);
    if (isHotelFeatureEnabled(featureConfig, "food")) enabled.push(staff);
  }

  enabled.sort((left, right) => {
    const leftManager = ["owner", "manager"].includes(String(left.role || "").toLowerCase());
    const rightManager = ["owner", "manager"].includes(String(right.role || "").toLowerCase());
    return Number(rightManager) - Number(leftManager);
  });
  return enabled;
}

async function main() {
  const staffUsers = await getFoodEnabledStaff();
  assert.ok(staffUsers.length, "No active staff account belongs to a food-enabled hotel");

  let primaryStaff = staffUsers[0];
  let token = signStaffToken(primaryStaff);
  let floorRead = null;
  let activeTable = null;

  for (const staff of staffUsers) {
    const candidateToken = signStaffToken(staff);
    const candidateFloor = await fetchJson("/api/staff/tables/floor", candidateToken);
    if (candidateFloor.response.status !== 200) continue;
    const candidateActiveTable = (candidateFloor.payload.tables || []).find(
      (table) => table?.activeOrder?.id
    );
    if (!floorRead) {
      primaryStaff = staff;
      token = candidateToken;
      floorRead = candidateFloor;
    }
    if (candidateActiveTable) {
      primaryStaff = staff;
      token = candidateToken;
      floorRead = candidateFloor;
      activeTable = candidateActiveTable;
      break;
    }
  }

  assert.ok(floorRead, "No authenticated restaurant floor could be read");
  assert.ok(
    activeTable,
    "No active table order is available to verify the repaired selected-order detail endpoint"
  );

  const menuRead = await fetchJson("/api/staff/menu", token);
  assert.strictEqual(menuRead.response.status, 200, "Staff menu read failed");
  assert.strictEqual(menuRead.payload.hotelSlug, primaryStaff.hotel_slug);
  assert.ok(Array.isArray(menuRead.payload.items), "Staff menu items must be an array");
  assert.strictEqual(menuRead.payload.count, menuRead.payload.items.length);
  assert.match(String(menuRead.payload.menuVersion || ""), /^[a-f0-9]{16}$/);
  assert.match(
    String(menuRead.response.headers.get("cache-control") || ""),
    /private/i,
    "Authenticated menu cache policy must stay private"
  );

  assert.strictEqual(floorRead.payload.hotelSlug, primaryStaff.hotel_slug);
  assert.ok(Array.isArray(floorRead.payload.tables), "Restaurant floor tables must be an array");

  const orderId = encodeURIComponent(activeTable.activeOrder.id);
  const tableNumber = encodeURIComponent(
    activeTable.activeOrder.tableNumber || activeTable.tableCode || ""
  );
  const detailRead = await fetchJson(
    `/api/staff/orders/table-activity/${orderId}?tableNumber=${tableNumber}`,
    token
  );
  assert.strictEqual(detailRead.response.status, 200, "Selected table-order detail read failed");
  assert.strictEqual(String(detailRead.payload.order?.id), String(activeTable.activeOrder.id));
  assert.ok(Array.isArray(detailRead.payload.order?.items), "Selected order must include items");
  assert.ok(detailRead.payload.order.items.length > 0, "Selected active order must expose its saved items");
  assert.ok(
    detailRead.payload.order?.totals &&
      typeof detailRead.payload.order.totals === "object" &&
      !Array.isArray(detailRead.payload.order.totals),
    "Selected order must include the full totals contract"
  );

  const otherHotelStaff = staffUsers.find(
    (staff) => String(staff.hotel_slug) !== String(primaryStaff.hotel_slug)
  );
  if (otherHotelStaff) {
    const crossTenantRead = await fetchJson(
      `/api/staff/orders/table-activity/${orderId}`,
      signStaffToken(otherHotelStaff)
    );
    assert.strictEqual(
      crossTenantRead.response.status,
      404,
      "A different hotel must not read the selected order"
    );
  }

  const kdsRead = await fetchJson(
    "/api/staff/kds/orders?includeServed=false&includeCancelled=false&limit=120",
    token
  );
  assert.strictEqual(kdsRead.response.status, 200, "KDS read failed");
  assert.strictEqual(kdsRead.payload.hotelSlug, primaryStaff.hotel_slug);
  assert.ok(Array.isArray(kdsRead.payload.orders), "KDS orders must be an array");
  kdsRead.payload.orders.forEach((order) => {
    ["customerName", "customerPhone", "paymentMethod", "totals"].forEach((field) => {
      assert.ok(!(field in order), `KDS response exposed restricted field: ${field}`);
    });
  });

  console.log(
    `LIVE Take Order/KDS reads: OK (hotel=${primaryStaff.hotel_slug}, menu=${menuRead.payload.items.length}, tables=${floorRead.payload.tables.length}, active-detail=${detailRead.payload.order.items.length} items, cross-tenant=${otherHotelStaff ? "denied" : "not available"}, kds=${kdsRead.payload.orders.length})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
