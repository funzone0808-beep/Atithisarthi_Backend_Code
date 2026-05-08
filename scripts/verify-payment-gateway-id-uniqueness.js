require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const PAGE_SIZE = 1000;
const DUPLICATE_PREVIEW_LIMIT = 10;

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Payment gateway id uniqueness check skipped: missing Supabase environment values.");
    process.exit(1);
  }

  return createClient(url, key);
}

async function fetchRowsWithGatewayId(supabase, columnName) {
  const rows = [];
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("orders")
      .select(`id,hotel_slug,${columnName},created_at`)
      .not(columnName, "is", null)
      .order("created_at", { ascending: true, nullsFirst: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return rows;
}

function normalizeGatewayId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function findDuplicateGatewayIds(rows, columnName) {
  const grouped = new Map();

  for (const row of rows) {
    const gatewayId = normalizeGatewayId(row?.[columnName]);

    if (!gatewayId) {
      continue;
    }

    if (!grouped.has(gatewayId)) {
      grouped.set(gatewayId, []);
    }

    grouped.get(gatewayId).push({
      id: row.id,
      hotelSlug: row.hotel_slug || "",
      createdAt: row.created_at || ""
    });
  }

  return [...grouped.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([gatewayId, records]) => ({
      gatewayId,
      count: records.length,
      hotels: [...new Set(records.map((record) => record.hotelSlug).filter(Boolean))],
      orderIds: records.map((record) => record.id),
      records
    }))
    .sort((left, right) => right.count - left.count || left.gatewayId.localeCompare(right.gatewayId));
}

function printDuplicateSummary(label, duplicates) {
  if (!duplicates.length) {
    console.log(`${label}: no duplicates found.`);
    return;
  }

  console.log(`${label}: ${duplicates.length} duplicate id group(s) found.`);

  duplicates.slice(0, DUPLICATE_PREVIEW_LIMIT).forEach((duplicate, index) => {
    const hotelList = duplicate.hotels.length ? duplicate.hotels.join(", ") : "unknown";
    const orderList = duplicate.orderIds.join(", ");
    console.log(
      `${index + 1}. ${duplicate.gatewayId} -> ${duplicate.count} rows | hotels: ${hotelList} | orders: ${orderList}`
    );
  });

  if (duplicates.length > DUPLICATE_PREVIEW_LIMIT) {
    console.log(
      `...and ${duplicates.length - DUPLICATE_PREVIEW_LIMIT} more duplicate group(s).`
    );
  }
}

async function main() {
  const supabase = getSupabaseClient();

  const [gatewayOrderRows, gatewayPaymentRows] = await Promise.all([
    fetchRowsWithGatewayId(supabase, "gateway_order_id"),
    fetchRowsWithGatewayId(supabase, "gateway_payment_id")
  ]);

  console.log("Payment gateway id uniqueness check");
  console.log("-----------------------------------");
  console.log(`Rows with gateway_order_id: ${gatewayOrderRows.length}`);
  console.log(`Rows with gateway_payment_id: ${gatewayPaymentRows.length}`);

  const gatewayOrderDuplicates = findDuplicateGatewayIds(
    gatewayOrderRows,
    "gateway_order_id"
  );
  const gatewayPaymentDuplicates = findDuplicateGatewayIds(
    gatewayPaymentRows,
    "gateway_payment_id"
  );

  printDuplicateSummary("gateway_order_id", gatewayOrderDuplicates);
  printDuplicateSummary("gateway_payment_id", gatewayPaymentDuplicates);

  if (gatewayOrderDuplicates.length || gatewayPaymentDuplicates.length) {
    console.log("");
    console.log(
      "Payment gateway ids are not unique yet. Clean these duplicates before adding database-level unique indexes."
    );
    process.exit(1);
  }

  console.log("");
  console.log(
    "Payment gateway ids look unique. It is safe to apply scripts/add-order-payment-gateway-unique-indexes.sql next."
  );
}

main().catch((error) => {
  console.error(`Payment gateway id uniqueness check failed: ${error.message}`);
  process.exit(1);
});
