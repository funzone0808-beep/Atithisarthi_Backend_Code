require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const REQUIRED_COLUMNS = [
  "id",
  "hotel_slug",
  "display_name",
  "role",
  "pin_hash",
  "is_active",
  "last_login_at",
  "created_at",
  "updated_at"
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Staff access schema check skipped: missing Supabase environment values.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("hotel_staff_access")
    .select(REQUIRED_COLUMNS.join(","))
    .limit(1);

  if (error) {
    console.log("Staff access schema is not ready yet.");
    console.log(`${error.code || "UNKNOWN"} ${error.message || ""}`.trim());
    console.log("Apply scripts/create-hotel-staff-access-table.sql when you are ready.");
    process.exit(1);
  }

  console.log("Staff access schema looks ready.");
  console.log(`Columns: ${REQUIRED_COLUMNS.join(", ")}`);
}

main().catch((error) => {
  console.error(`Staff access schema check failed: ${error.message}`);
  process.exit(1);
});
