require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const STAFF_ACCESS_SELECT_COLUMNS = [
  "id",
  "hotel_slug",
  "display_name",
  "role",
  "is_active",
  "last_login_at",
  "created_at"
].join(",");

const STAFF_ORDER_SELECT_COLUMNS = [
  "id",
  "hotel_name",
  "hotel_slug",
  "order_type",
  "table_number",
  "order_source",
  "payment_method",
  "payment_status",
  "billing_status",
  "bill_number",
  "billed_at",
  "paid_at",
  "totals",
  "items",
  "status",
  "created_at"
].join(",");

function getHotelSlugArg() {
  return String(process.argv[2] || "").trim();
}

function normalizeStatus(value = "", fallback = "") {
  return String(value || fallback).trim().toLowerCase();
}

function isDineInOrder(order = {}) {
  return (
    normalizeStatus(order.order_type) === "dine-in" ||
    !!String(order.table_number || "").trim()
  );
}

function getOrderItems(order = {}) {
  return Array.isArray(order.items) ? order.items : [];
}

function getNumberValue(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getOrderTotal(order = {}) {
  const totals =
    order.totals && typeof order.totals === "object" && !Array.isArray(order.totals)
      ? order.totals
      : {};
  const itemSubtotal = getOrderItems(order).reduce((sum, item) => {
    const qty = getNumberValue(item?.qty) || 0;
    const price = getNumberValue(item?.price) || 0;
    return sum + qty * price;
  }, 0);

  return (
    getNumberValue(totals.gpayFinalTotal) ??
    getNumberValue(totals.final) ??
    getNumberValue(totals.total) ??
    getNumberValue(totals.normalTotal) ??
    itemSubtotal
  );
}

function formatMoney(value) {
  const numberValue = getNumberValue(value);
  return numberValue === null ? "Rs. 0.00" : `Rs. ${numberValue.toFixed(2)}`;
}

function countBy(orders = [], getKey) {
  return orders.reduce((counts, order) => {
    const key = getKey(order);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function printCounts(label, counts = {}) {
  const entries = Object.entries(counts);

  if (!entries.length) {
    console.log(`${label}: none`);
    return;
  }

  console.log(
    `${label}: ${entries.map(([key, count]) => `${key}=${count}`).join(" | ")}`
  );
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hotelSlug = getHotelSlugArg();

  if (!url || !key) {
    console.log("Staff billing dry run skipped: missing Supabase environment values.");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { error: staffAccessError } = await supabase
    .from("hotel_staff_access")
    .select(STAFF_ACCESS_SELECT_COLUMNS)
    .limit(1);

  if (staffAccessError) {
    console.log("Staff access schema is not ready yet.");
    console.log(`${staffAccessError.code || "UNKNOWN"} ${staffAccessError.message || ""}`.trim());
    console.log("Apply scripts/create-hotel-staff-access-table.sql first.");
    process.exit(1);
  }

  const { error: orderSchemaError } = await supabase
    .from("orders")
    .select(STAFF_ORDER_SELECT_COLUMNS)
    .limit(1);

  if (orderSchemaError) {
    console.log("Staff billing order schema is not ready yet.");
    console.log(`${orderSchemaError.code || "UNKNOWN"} ${orderSchemaError.message || ""}`.trim());
    console.log("Confirm QR table and billing metadata order columns are applied.");
    process.exit(1);
  }

  let staffQuery = supabase
    .from("hotel_staff_access")
    .select(STAFF_ACCESS_SELECT_COLUMNS)
    .eq("is_active", true)
    .order("hotel_slug", { ascending: true })
    .limit(20);

  let ordersQuery = supabase
    .from("orders")
    .select(STAFF_ORDER_SELECT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);

  if (hotelSlug) {
    staffQuery = staffQuery.eq("hotel_slug", hotelSlug);
    ordersQuery = ordersQuery.eq("hotel_slug", hotelSlug);
  }

  const { data: staffRows, error: staffRowsError } = await staffQuery;
  if (staffRowsError) {
    console.log("Staff access read failed.");
    console.log(`${staffRowsError.code || "UNKNOWN"} ${staffRowsError.message || ""}`.trim());
    process.exit(1);
  }

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) {
    console.log("Staff order read failed.");
    console.log(`${ordersError.code || "UNKNOWN"} ${ordersError.message || ""}`.trim());
    process.exit(1);
  }

  const safeStaffRows = staffRows || [];
  const safeOrders = orders || [];
  const dineInOrders = safeOrders.filter(isDineInOrder);

  console.log("Staff billing dry run looks ready.");
  console.log("No database writes were made.");
  console.log(`Hotel filter: ${hotelSlug || "all hotels"}`);
  console.log(`Active staff credentials found: ${safeStaffRows.length}`);
  console.log(`Recent orders read: ${safeOrders.length}`);
  console.log(`Recent dine-in/table orders read: ${dineInOrders.length}`);

  printCounts(
    "Payment statuses",
    countBy(dineInOrders, (order) => normalizeStatus(order.payment_status, "unpaid"))
  );
  printCounts(
    "Billing statuses",
    countBy(dineInOrders, (order) => normalizeStatus(order.billing_status, "not_billed"))
  );

  if (!dineInOrders.length) {
    console.log("No dine-in/table orders found in the selected recent order set.");
    return;
  }

  dineInOrders.slice(0, 5).forEach((order) => {
    console.log([
      `Order ${order.id}`,
      `hotel=${order.hotel_slug || order.hotel_name || "unknown"}`,
      `table=${order.table_number || "not-set"}`,
      `billing=${normalizeStatus(order.billing_status, "not_billed")}`,
      `payment=${normalizeStatus(order.payment_status, "unpaid")}`,
      `bill=${order.bill_number || "not-generated"}`,
      `total=${formatMoney(getOrderTotal(order))}`,
      `items=${getOrderItems(order).length}`
    ].join(" | "));
  });
}

main().catch((error) => {
  console.error(`Staff billing dry run failed: ${error.message}`);
  process.exit(1);
});
