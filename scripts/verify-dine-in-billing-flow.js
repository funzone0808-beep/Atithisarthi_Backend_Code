require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const ORDER_SELECT_COLUMNS = [
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
  "created_at"
].join(",");

function getNumberValue(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatMoney(value) {
  const numberValue = getNumberValue(value);
  return numberValue === null ? "Rs. 0.00" : `Rs. ${numberValue.toFixed(2)}`;
}

function getOrderItems(order = {}) {
  return Array.isArray(order.items) ? order.items : [];
}

function getItemSubtotal(order = {}) {
  return getOrderItems(order).reduce((sum, item) => {
    const qty = getNumberValue(item?.qty) || 0;
    const price = getNumberValue(item?.price) || 0;
    return sum + qty * price;
  }, 0);
}

function getOrderTotals(order = {}) {
  return order.totals && typeof order.totals === "object" && !Array.isArray(order.totals)
    ? order.totals
    : {};
}

function isUpiOrder(order = {}) {
  const paymentMethod = String(order.payment_method || "").trim().toLowerCase();
  return paymentMethod.includes("upi") || paymentMethod.includes("google pay");
}

function getFinalTotal(order = {}) {
  const totals = getOrderTotals(order);
  const itemSubtotal = getItemSubtotal(order);

  if (isUpiOrder(order)) {
    return (
      getNumberValue(totals.gpayFinalTotal) ??
      getNumberValue(totals.total) ??
      getNumberValue(totals.normalTotal) ??
      itemSubtotal
    );
  }

  return (
    getNumberValue(totals.total) ??
    getNumberValue(totals.normalTotal) ??
    getNumberValue(totals.gpayFinalTotal) ??
    itemSubtotal
  );
}

function isDineInOrder(order = {}) {
  return (
    String(order.order_type || "").trim().toLowerCase() === "dine-in" ||
    !!String(order.table_number || "").trim()
  );
}

function getBillingStatus(order = {}) {
  return String(order.billing_status || "not_billed").trim().toLowerCase();
}

function getPaymentStatus(order = {}) {
  return String(order.payment_status || "unpaid").trim().toLowerCase();
}

function getPaymentStatusLabel(paymentStatus = "") {
  const normalizedStatus = String(paymentStatus || "").trim().toLowerCase();
  const labels = {
    unpaid: "unpaid",
    customer_confirmed: "customer_confirmed_verify_before_paid",
    paid: "paid",
    refunded: "refunded"
  };

  return labels[normalizedStatus] || normalizedStatus.replace(/_/g, "-");
}

function printOrderIds(label, orders = []) {
  if (!orders.length) return;

  console.log(`${label}: ${orders.map((order) => order.id).join(", ")}`);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Dine-in billing dry run skipped: missing Supabase environment values.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { error: schemaError } = await supabase
    .from("orders")
    .select(ORDER_SELECT_COLUMNS)
    .limit(1);

  if (schemaError) {
    console.log("Dine-in billing dry run is not ready yet.");
    console.log(`${schemaError.code || "UNKNOWN"} ${schemaError.message || ""}`.trim());
    console.log("Confirm QR table and billing metadata columns are applied.");
    process.exit(1);
  }

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.log("Dine-in billing dry run failed while reading recent orders.");
    console.log(`${error.code || "UNKNOWN"} ${error.message || ""}`.trim());
    process.exit(1);
  }

  const dineInOrders = (data || []).filter(isDineInOrder);

  console.log("Dine-in billing dry run looks ready.");
  console.log("No database writes were made.");

  if (!dineInOrders.length) {
    console.log("No recent dine-in/table orders found in the latest 50 orders.");
    console.log("Create one QR table order, then run this check again.");
    return;
  }

  console.log(`Recent dine-in/table orders found: ${dineInOrders.length}`);
  dineInOrders.slice(0, 5).forEach((order) => {
    console.log([
      `Order ${order.id}`,
      `hotel=${order.hotel_slug || order.hotel_name || "unknown"}`,
      `table=${order.table_number || "not-set"}`,
      `billing=${getBillingStatus(order)}`,
      `payment=${getPaymentStatusLabel(getPaymentStatus(order))}`,
      `bill=${order.bill_number || "not-generated"}`,
      `total=${formatMoney(getFinalTotal(order))}`,
      `items=${getOrderItems(order).length}`
    ].join(" | "));
  });

  const billedWithoutNumber = dineInOrders.filter(
    (order) => getBillingStatus(order) === "billed" && !order.bill_number
  );
  const billedWithoutTimestamp = dineInOrders.filter(
    (order) => getBillingStatus(order) === "billed" && !order.billed_at
  );
  const paidWithoutTimestamp = dineInOrders.filter(
    (order) => getPaymentStatus(order) === "paid" && !order.paid_at
  );
  const paidButNotBilled = dineInOrders.filter(
    (order) => getPaymentStatus(order) === "paid" && getBillingStatus(order) !== "billed"
  );
  const billedButUnpaid = dineInOrders.filter(
    (order) => getBillingStatus(order) === "billed" && getPaymentStatus(order) !== "paid"
  );
  const billedAndPaid = dineInOrders.filter(
    (order) => getBillingStatus(order) === "billed" && getPaymentStatus(order) === "paid"
  );

  if (billedWithoutNumber.length) {
    console.log(
      `Warning: ${billedWithoutNumber.length} billed dine-in order(s) do not have bill numbers yet.`
    );
    printOrderIds("Billed without bill number", billedWithoutNumber);
  }

  const inactiveOrdersWithBillNumbers = dineInOrders.filter(
    (order) => order.bill_number && getBillingStatus(order) !== "billed"
  );

  if (inactiveOrdersWithBillNumbers.length) {
    console.log(
      `Review: ${inactiveOrdersWithBillNumbers.length} dine-in order(s) have saved bill references while not currently billed.`
    );
    console.log("This preserves bill references for audit/history; admin UI labels them as saved refs.");
  }

  if (billedWithoutTimestamp.length) {
    printOrderIds("Review billed orders without billed_at", billedWithoutTimestamp);
  }

  if (paidWithoutTimestamp.length) {
    printOrderIds("Review paid orders without paid_at", paidWithoutTimestamp);
  }

  if (paidButNotBilled.length) {
    printOrderIds("Review paid orders that are not currently billed", paidButNotBilled);
  }

  if (billedButUnpaid.length) {
    printOrderIds("Open billed but unpaid orders", billedButUnpaid);
  }

  console.log(
    [
      "Consistency summary",
      `billed_and_paid=${billedAndPaid.length}`,
      `billed_unpaid=${billedButUnpaid.length}`,
      `paid_not_billed=${paidButNotBilled.length}`,
      `billed_missing_number=${billedWithoutNumber.length}`
    ].join(" | ")
  );
}

main().catch((error) => {
  console.error(`Dine-in billing dry run failed: ${error.message}`);
  process.exit(1);
});
