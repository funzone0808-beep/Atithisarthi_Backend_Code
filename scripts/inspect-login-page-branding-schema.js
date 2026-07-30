"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const { supabase } = require("../utils/supabase");

async function inspectTable(table, columns) {
  const { data, error } = await supabase.from(table).select(columns).limit(1);
  if (error) {
    return {
      ok: false,
      table,
      code: String(error.code || ""),
      message: String(error.message || "Schema inspection failed")
    };
  }
  return { ok: true, table, sampleRows: Array.isArray(data) ? data.length : 0 };
}

async function main() {
  const branding = await inspectTable(
    "login_page_branding",
    "id,scope_type,hotel_slug,draft_config,published_config,is_published,version,created_by,updated_by,published_by,created_at,updated_at,published_at"
  );
  const audit = await inspectTable(
    "login_page_branding_audit",
    "id,branding_id,scope_type,hotel_slug,action,actor_id,metadata,created_at"
  );

  console.log("Login branding live schema inspection");
  console.log(`- login_page_branding: ${branding.ok ? "available" : `unavailable (${branding.code || "unknown"})`}`);
  console.log(`- login_page_branding_audit: ${audit.ok ? "available" : `unavailable (${audit.code || "unknown"})`}`);

  if (!branding.ok || !audit.ok) {
    if (!branding.ok) console.log(`  branding detail: ${branding.message}`);
    if (!audit.ok) console.log(`  audit detail: ${audit.message}`);
    console.log("Migration is not verified as applied. Run create-login-page-branding.sql through the approved Supabase SQL workflow.");
    process.exitCode = 2;
    return;
  }

  const { data: platformRows, error: platformError } = await supabase
    .from("login_page_branding")
    .select("id,is_published,version")
    .eq("scope_type", "platform")
    .is("hotel_slug", null)
    .limit(2);

  if (platformError) {
    console.log(`- platform seed: inspection failed (${platformError.code || "unknown"})`);
    process.exitCode = 2;
    return;
  }

  const platformCount = Array.isArray(platformRows) ? platformRows.length : 0;
  console.log(`- platform seed rows: ${platformCount}`);
  console.log(`- platform published: ${platformCount === 1 && platformRows[0]?.is_published === true ? "yes" : "no"}`);
  console.log(`- platform version: ${platformCount === 1 ? Number(platformRows[0]?.version || 0) : 0}`);

  if (platformCount !== 1) {
    console.log("Schema exists, but the single platform-default seed is incomplete or duplicated.");
    process.exitCode = 2;
    return;
  }

  console.log("Live login branding tables and platform seed are available.");
}

main().catch((error) => {
  console.error(`Login branding schema inspection failed: ${error.message || error}`);
  process.exitCode = 1;
});
