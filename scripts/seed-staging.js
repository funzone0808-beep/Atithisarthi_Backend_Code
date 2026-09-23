"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { createClient } = require("@supabase/supabase-js");

function projectRef(urlValue) {
  try { return new URL(urlValue).hostname.split(".")[0].toLowerCase(); } catch { return ""; }
}

function assertStagingGuard() {
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  const environmentId = String(process.env.STAGING_ENVIRONMENT_ID || "").toLowerCase();
  const urlRef = projectRef(process.env.SUPABASE_URL || "");
  const stagingRef = String(process.env.STAGING_SUPABASE_PROJECT_REF || "").toLowerCase();
  const productionRef = String(process.env.PRODUCTION_SUPABASE_PROJECT_REF || "").toLowerCase();
  if (nodeEnv !== "staging") throw new Error("ABORT: NODE_ENV must be exactly staging");
  if (!environmentId.includes("staging")) throw new Error("ABORT: STAGING_ENVIRONMENT_ID must identify staging");
  if (process.env.ALLOW_STAGING_SEED !== "yes") throw new Error("ABORT: ALLOW_STAGING_SEED must be exactly yes");
  if (!urlRef || !stagingRef || urlRef !== stagingRef) throw new Error("ABORT: configured Supabase project does not match STAGING_SUPABASE_PROJECT_REF");
  if (productionRef && urlRef === productionRef) throw new Error("ABORT: staging and production Supabase project references match");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("ABORT: staging service role key is missing");
}

const hotels = [
  { hotel_slug: "test-hotel-alpha", hotel_name: "Test Hotel Alpha", is_active: true },
  { hotel_slug: "test-hotel-beta", hotel_name: "Test Hotel Beta", is_active: true }
];

async function upsert(supabase, table, rows, onConflict) {
  const result = await supabase.from(table).upsert(rows, { onConflict }).select();
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data || [];
}

async function main() {
  assertStagingGuard();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  await upsert(supabase, "hotels", hotels, "hotel_slug");
  await upsert(supabase, "hotel_profiles", hotels.map((hotel) => ({
    hotel_slug: hotel.hotel_slug,
    hotel_name: hotel.hotel_name,
    phone: "+919000000000",
    email: `${hotel.hotel_slug}@example.invalid`,
    address: "Synthetic staging address",
    gst_number: "22AAAAA0000A1Z5"
  })), "hotel_slug");
  console.log("Staging seed completed for Test Hotel Alpha and Test Hotel Beta using synthetic data only.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
