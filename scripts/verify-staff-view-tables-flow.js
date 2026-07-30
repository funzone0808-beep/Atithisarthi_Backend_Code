const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(projectRoot, "frontend", "staff-orders.html"), "utf8");
const frontend = fs.readFileSync(path.join(projectRoot, "frontend", "js", "staff-orders.js"), "utf8");
const staffRoute = fs.readFileSync(path.join(projectRoot, "backend", "routes", "staff.js"), "utf8");
const staffTablesRoute = fs.readFileSync(path.join(projectRoot, "backend", "routes", "staff-tables.js"), "utf8");

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Missing ${label}`);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function verifyRuntimeOrderingAndFilters() {
  const filterConstant = frontend.match(
    /const STAFF_TABLE_ACTIVITY_FILTERS = Object\.freeze\(\{[\s\S]*?\n\}\);/
  )?.[0];
  if (!filterConstant) throw new Error("Missing centralized table activity filter mapping");

  const context = {};
  vm.runInNewContext(
    [
      'const STAFF_STATE = { tableFloor: [], tableActivityStatus: "all", tableActivityQuery: "" };',
      filterConstant,
      'function normalizeStatus(value) { return String(value || "").trim().toLowerCase(); }',
      extractFunction(frontend, "getStaffTableActivityFilterStatuses"),
      extractFunction(frontend, "getStaffTableActivityCounts"),
      extractFunction(frontend, "getFilteredStaffTableActivity"),
      'globalThis.__test = { STAFF_STATE, STAFF_TABLE_ACTIVITY_FILTERS, getFilteredStaffTableActivity, getStaffTableActivityCounts };'
    ].join("\n"),
    context
  );

  const test = context.__test;
  assert.deepStrictEqual(Array.from(test.STAFF_TABLE_ACTIVITY_FILTERS.new), ["new"]);
  assert.deepStrictEqual(Array.from(test.STAFF_TABLE_ACTIVITY_FILTERS.available), ["available"]);
  test.STAFF_STATE.tableFloor = [
    { id: "20", liveStatus: "new", tableCode: "T20", tableName: "Table T20" },
    { id: "10", liveStatus: "new", tableCode: "T10", tableName: "Table T10" },
    { id: "2", liveStatus: "available", tableCode: "T02", tableName: "Table T02" },
    { id: "30", liveStatus: "billing_pending", tableCode: "T30", tableName: "Table T30" }
  ];
  test.STAFF_STATE.tableActivityStatus = "new";
  assert.deepStrictEqual(
    Array.from(test.getFilteredStaffTableActivity(), (table) => table.id),
    ["20", "10"]
  );
  assert.strictEqual(test.getStaffTableActivityCounts().new, 2);
  assert.strictEqual(test.getStaffTableActivityCounts().available, 1);
  assert.strictEqual(test.getStaffTableActivityCounts().billing_pending, 1);

  const backendContext = {};
  vm.runInNewContext(
    extractFunction(staffRoute, "groupStaffActiveTableOrders") + "\n" +
      'globalThis.__group = groupStaffActiveTableOrders;',
    backendContext
  );
  const grouped = backendContext.__group([
    { id: 8, table_number: "T01", created_at: "2026-07-13T10:00:00.000Z" },
    { id: 9, table_number: "t01", created_at: "2026-07-13T10:00:00.000Z" },
    { id: 7, table_number: "T02", created_at: "2026-07-13T11:00:00.000Z" }
  ]);
  assert.deepStrictEqual(Array.from(grouped, (order) => String(order.id)), ["7", "9"]);
  assert.strictEqual(grouped[1].activeRecordCount, 2);

  const tableLifecycleContext = {};
  vm.runInNewContext(
    [
      'const ACTIVE_STATUSES = ["new", "confirmed", "preparing"];',
      extractFunction(staffTablesRoute, "blocksTable"),
      'globalThis.__blocksTable = blocksTable;'
    ].join("\n"),
    tableLifecycleContext
  );
  const blocksTable = tableLifecycleContext.__blocksTable;
  assert.strictEqual(blocksTable({ status: "completed", kitchen_status: "new", payment_status: "paid", billing_status: "billed" }), false);
  assert.strictEqual(blocksTable({ status: "completed", kitchen_status: "served", payment_status: "unpaid", billing_status: "billed" }), true);
  assert.strictEqual(blocksTable({ status: "new", kitchen_status: "new", payment_status: "unpaid", billing_status: "not_billed" }), true);
  assert.strictEqual(blocksTable({ status: "cancelled", kitchen_status: "new", payment_status: "unpaid", billing_status: "not_billed" }), false);
}

function main() {
  requirePattern(staffRoute, /router\.get\("\/orders\/table-activity"[\s\S]*?\.eq\("hotel_slug", hotelSlug\)[\s\S]*?\.in\("status", STAFF_ACTIVE_TABLE_ORDER_STATUSES\)[\s\S]*?\.order\("created_at", \{ ascending: false \}\)[\s\S]*?\.order\("id", \{ ascending: false \}\)/m, "authoritative backend newest-first query");
  requirePattern(staffRoute, /router\.get\("\/orders\/table-activity\/:id", requireStaffAuth[\s\S]*?\.eq\("id", orderId\)[\s\S]*?\.eq\("hotel_slug", hotelSlug\)[\s\S]*?query = query\.eq\("table_number", tableNumber\)[\s\S]*?canStaffViewOrderFinancials\(req\)/m, "tenant/table-scoped selected order endpoint");
  requirePattern(frontend, /const STAFF_TABLE_ACTIVITY_FILTERS = Object\.freeze\(\{[\s\S]*?new: Object\.freeze\(\["new"\]\)/m, "verified New mapping");
  requirePattern(staffTablesRoute, /if \(!!first\.activeOrder !== !!second\.activeOrder\) return first\.activeOrder \? -1 : 1;[\s\S]*?return secondTime - firstTime;[\s\S]*?first\.displayOrder - second\.displayOrder/m, "floor newest-first and available display ordering");
  requirePattern(frontend, /const nextFloor = Array\.isArray\(result\.tables\)[\s\S]*?nextFloor\.map\(\(table\) => table\.activeOrder\)\.filter\(Boolean\)[\s\S]*?mergeStaffSelectedTableOrderSummary/m, "stable floor normalization");
  requirePattern(frontend, /async function openStaffOrderFromTableActivity[\s\S]*?selectedTableOrderId = normalizedOrderId[\s\S]*?renderStaffTableActivity\(\)[\s\S]*?loadSelectedStaffTableOrder\(\)/m, "same-page order open");
  requirePattern(frontend, /function applyStaffOrderMutationResult[\s\S]*?selectedTableOrder[\s\S]*?renderStaffTableActivity\(\)/m, "in-place AJAX mutation rendering");
  requirePattern(frontend, /error\?\.status === 409[\s\S]*?loadSelectedStaffTableOrder\(\{ announceConflict: true \}\)/m, "conflict recovery");
  requirePattern(frontend, /function closeStaffTableOrderDetail[\s\S]*?tableActivityScrollTop[\s\S]*?focus\(\{ preventScroll: true \}\)/m, "filter/search/scroll focus restoration");
  requirePattern(frontend, /STAFF_STATE\.activeView === "table-order"[\s\S]*?STAFF_STATE\.tableOrderSubview === "tables"[\s\S]*?loadStaffTableActivity\(\{ silent \}\)/m, "live table polling");
  requirePattern(html, /id="staffTakeOrderDetailPanel"[\s\S]*?id="staffTakeOrderDetailStatus"[^>]*role="status"[\s\S]*?id="staffTakeOrderDetailContent"/m, "accessible detail panel");
  requirePattern(html, /@media \(max-width: 760px\)[\s\S]*?#staffTableOrderPanel \.staff-take-order-detail-panel[\s\S]*?position: fixed[\s\S]*?inset: 0/m, "mobile full-screen detail mode");

  const openFunction = extractFunction(frontend, "openStaffOrderFromTableActivity");
  assert.ok(!openFunction.includes('openStaffView("orders")'), "View Tables must not redirect to Orders");
  assert.ok(!frontend.includes("location.reload("), "normal staff updates must not reload the page");

  verifyRuntimeOrderingAndFilters();
  console.log("Staff View Tables flow verification passed.");
}

main();