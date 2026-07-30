const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assertIncludes = (source, fragment, label) => {
  if (!source.includes(fragment)) throw new Error(`${label}: missing ${fragment}`);
};

const migration = read("scripts/create-restaurant-table-master.sql");
const guard = read("scripts/upgrade-restaurant-table-order-guard.sql");
const resolver = read("utils/restaurant-tables.js");
const tableRoutes = read("routes/staff-tables.js");
const staffRoutes = read("routes/staff.js");
const publicOrders = read("routes/orders.js");
const payments = read("routes/payments.js");
const staffValidator = read("validators/staff.js");
const staffUi = read(path.join("..", "frontend", "js", "staff-orders.js"));
const staffHtml = read(path.join("..", "frontend", "staff-orders.html"));

assertIncludes(migration, "create table if not exists public.restaurant_tables", "table master migration");
assertIncludes(migration, "uq_restaurant_tables_hotel_code", "hotel-scoped uniqueness");
assertIncludes(migration, "add column if not exists restaurant_table_id", "order linkage");
assertIncludes(migration, "enforce_table_master boolean not null default false", "compatibility gate");
assertIncludes(guard, "for update", "table row lock");
assertIncludes(guard, "v_table.operational_status <> 'active'", "operational validation");
assertIncludes(guard, "restaurant_table_id, table_number", "atomic linked insert");
assertIncludes(guard, "pg_advisory_xact_lock", "duplicate-order serialization");
assertIncludes(resolver, '.eq("hotel_slug", scopedHotel)', "tenant-scoped resolver");
assertIncludes(resolver, "TABLE_NOT_CONFIGURED", "enforcement response");
assertIncludes(tableRoutes, 'router.get("/tables/floor", requireStaffAuth', "staff floor permission");
assertIncludes(tableRoutes, 'router.post("/tables", requireStaffAuth, requireStaffManagerAccess', "manager create permission");
assertIncludes(tableRoutes, 'router.patch("/tables/:id", requireStaffAuth, requireStaffManagerAccess', "manager edit permission");
assertIncludes(tableRoutes, 'router.post("/tables/bulk", requireStaffAuth, requireStaffManagerAccess', "manager bulk permission");
assertIncludes(tableRoutes, 'router.post("/tables/:id/qr", requireStaffAuth, requireStaffManagerAccess', "manager QR permission");
assertIncludes(tableRoutes, '.eq("hotel_slug", hotelSlug)', "hotel-scoped table queries");
assertIncludes(staffRoutes, "resolveTableForOrder", "staff order resolution");
assertIncludes(staffRoutes, "restaurant_table_id: tableResolution.restaurantTableId", "staff order ID linkage");
assertIncludes(publicOrders, "resolveTableForOrder", "public/QR order resolution");
assertIncludes(publicOrders, "restaurant_table_id: tableResolution.restaurantTableId", "public order ID linkage");
assertIncludes(payments, "resolveTableForOrder", "payment order resolution");
assertIncludes(payments, "restaurantTableId: tableResolution?.restaurantTableId", "payment order ID linkage");
assertIncludes(staffValidator, "restaurantTableId", "additive staff payload");
assertIncludes(staffHtml, 'data-staff-table-activity-status="available"', "Available filter");
assertIncludes(staffHtml, 'data-staff-table-activity-status="ready"', "Ready filter");
assertIncludes(staffHtml, 'data-staff-table-activity-status="billing_pending"', "Billing Pending filter");
assertIncludes(staffHtml, "staffTableManagementPanel", "manager table UI");
assertIncludes(staffUi, 'STAFF_API_BASE + "/tables/floor"', "authoritative floor API");
assertIncludes(staffUi, "selectAvailableRestaurantTable", "available table flow");
assertIncludes(staffUi, "selectedRestaurantTableId", "locked table context");
assertIncludes(staffUi, 'showStaffTakeOrderSubview("tables", { focus: false })', "same-page post-create flow");
assertIncludes(staffUi, "loadStaffTableActivity({ silent: true })", "AJAX floor mutation refresh");

console.log("Restaurant Table Master release verification passed.");
