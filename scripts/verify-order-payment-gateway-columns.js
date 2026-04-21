require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const REQUIRED_COLUMNS = [
  "payment_status",
  "billing_status",
  "paid_at",
  "order_type",
  "table_number",
  "order_source",
  "payment_gateway",
  "gateway_order_id",
  "gateway_payment_id",
  "gateway_signature",
  "gateway_status",
  "payment_verified_at",
  "payment_amount",
  "payment_currency",
  "payment_error",
  "payment_metadata"
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Payment gateway schema check skipped: missing Supabase environment values.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const selectColumns = ["id", ...REQUIRED_COLUMNS].join(",");
  const { error } = await supabase
    .from("orders")
    .select(selectColumns)
    .limit(1);

  if (error) {
    console.log("Payment gateway schema is not ready yet.");
    console.log(`${error.code || "UNKNOWN"} ${error.message || ""}`.trim());
    console.log("Apply scripts/add-order-payment-gateway-columns.sql when you are ready.");
    process.exit(1);
  }

  console.log("Payment gateway schema looks ready.");
  console.log(`Columns: ${REQUIRED_COLUMNS.join(", ")}`);
}

main().catch((error) => {
  console.error(`Payment gateway schema check failed: ${error.message}`);
  process.exit(1);
});
