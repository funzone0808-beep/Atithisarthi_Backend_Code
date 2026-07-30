"use strict";

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const REQUIRED_CONFIRMATION = "I_UNDERSTAND_STAGING_ONLY";
const RECEIPT_COLUMNS = [
  "id",
  "hotel_slug",
  "booking_id",
  "idempotency_key",
  "amount",
  "room_amount",
  "food_amount",
  "currency",
  "payment_method",
  "payment_status",
  "transaction_id",
  "settled_order_ids",
  "allocations_json",
  "paid_at",
  "created_at"
];

function formatError(error = {}) {
  return `${error.code || "UNKNOWN"} ${error.message || ""}`.trim();
}

async function verifyReceiptSchema(supabase) {
  const { error } = await supabase
    .from("room_checkout_receipts")
    .select(RECEIPT_COLUMNS.join(","))
    .limit(1);

  if (error) {
    throw new Error(`Checkout receipt schema is unavailable: ${formatError(error)}`);
  }
}

async function verifyRpcGuard(supabase) {
  const { data, error } = await supabase.rpc("settle_room_combined_checkout", {
    p_hotel_slug: "",
    p_booking_id: 0,
    p_amount: 0,
    p_payment_method: "staging_schema_probe",
    p_transaction_id: null,
    p_notes: "Read-only staging schema probe",
    p_created_by_user_id: null,
    p_created_by_role: "schema_probe",
    p_idempotency_key: "staging-schema-probe",
    p_currency: "INR"
  });

  if (!error) {
    throw new Error(
      `Checkout RPC unexpectedly accepted the invalid staging probe: ${JSON.stringify(data)}`
    );
  }

  const code = String(error.code || "").trim().toUpperCase();
  const message = String(error.message || "").trim();

  if (code !== "22023" || !message.includes("Hotel scope is required")) {
    throw new Error(`Checkout RPC guard returned an unexpected error: ${formatError(error)}`);
  }
}

async function main() {
  if (process.env.ROOM_CHECKOUT_STAGING_VERIFY !== REQUIRED_CONFIRMATION) {
    console.log("Combined checkout staging verification refused.");
    console.log(
      `Set ROOM_CHECKOUT_STAGING_VERIFY=${REQUIRED_CONFIRMATION} only for an explicitly confirmed staging database.`
    );
    console.log("No Supabase request was made.");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Combined checkout staging verification skipped: missing Supabase environment values.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  await verifyReceiptSchema(supabase);
  await verifyRpcGuard(supabase);

  console.log("Combined checkout staging schema verification passed.");
  console.log(`Receipt columns: ${RECEIPT_COLUMNS.join(", ")}`);
  console.log("RPC exists, is callable by service_role, and rejects invalid hotel scope before any write.");
  console.log("No database writes were made.");
}

main().catch((error) => {
  console.error(`Combined checkout staging verification failed: ${error.message}`);
  process.exit(1);
});