require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const REQUIRED_COLUMNS = [
  "room_id",
  "room_booking_id",
  "room_number",
  "room_service_guest_name",
  "room_service_charge_to_room"
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Room service order schema check skipped: missing Supabase environment values.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const selectColumns = ["id", ...REQUIRED_COLUMNS].join(",");
  const { error } = await supabase
    .from("orders")
    .select(selectColumns)
    .limit(1);

  if (error) {
    console.log("Room service order schema is not ready yet.");
    console.log(`${error.code || "UNKNOWN"} ${error.message || ""}`.trim());
    console.log("Apply scripts/add-order-room-service-columns.sql when you are ready.");
    process.exit(1);
  }

  console.log("Room service order schema looks ready.");
  console.log(`Columns: ${REQUIRED_COLUMNS.join(", ")}`);
}

main().catch((error) => {
  console.error(`Room service order schema check failed: ${error.message}`);
  process.exit(1);
});
