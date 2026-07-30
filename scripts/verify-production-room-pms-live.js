"use strict";

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

function fail(message, error = {}) {
  const detail = `${error.code || ""} ${error.message || ""}`.trim();
  throw new Error(detail ? `${message}: ${detail}` : message);
}

async function selectColumns(supabase, table, columns) {
  const { data, error } = await supabase.from(table).select(columns.join(",")).limit(1);
  if (error) fail(`${table} is not ready`, error);
  return data || [];
}

function overlaps(left, right) {
  const leftEnd = left.effective_to || "9999-12-31";
  const rightEnd = right.effective_to || "9999-12-31";
  const valueOverlap =
    Number(left.minimum_taxable_value || 0) <= Number(right.maximum_taxable_value ?? Number.MAX_SAFE_INTEGER) &&
    Number(right.minimum_taxable_value || 0) <= Number(left.maximum_taxable_value ?? Number.MAX_SAFE_INTEGER);
  return left.effective_from <= rightEnd && right.effective_from <= leftEnd && valueOverlap;
}

async function auditActiveTaxRules(supabase) {
  const { data, error } = await supabase.from("room_tax_rules")
    .select("id,hotel_slug,effective_from,effective_to,minimum_taxable_value,maximum_taxable_value,status")
    .eq("status", "active")
    .order("hotel_slug")
    .order("effective_from")
    .limit(2000);
  if (error) fail("Active Room GST rule audit failed", error);
  const rules = data || [];
  const conflicts = [];
  for (let index = 0; index < rules.length; index += 1) {
    for (let other = index + 1; other < rules.length; other += 1) {
      if (rules[index].hotel_slug !== rules[other].hotel_slug) break;
      if (overlaps(rules[index], rules[other])) {
        conflicts.push(`${rules[index].hotel_slug}: rules ${rules[index].id} and ${rules[other].id}`);
      }
    }
  }
  return { count: rules.length, conflicts, truncated: rules.length >= 2000 };
}

async function auditForeignScope(supabase) {
  const { data: refunds, error: refundError } = await supabase.from("room_booking_refunds")
    .select("id,hotel_slug,booking_id,room_bookings!inner(hotel_slug)")
    .order("id", { ascending: false })
    .limit(1000);
  if (refundError) fail("Room refund hotel-scope audit failed", refundError);
  const refundMismatches = (refunds || []).filter((refund) =>
    String(refund.hotel_slug) !== String(refund.room_bookings?.hotel_slug)
  );

  const { data: plans, error: planError } = await supabase.from("room_rate_plans")
    .select("id,hotel_slug,room_id,room_type_id,rooms(hotel_slug),room_types(hotel_slug)")
    .or("room_id.not.is.null,room_type_id.not.is.null")
    .order("id", { ascending: false })
    .limit(1000);
  if (planError) fail("Room rate-plan hotel-scope audit failed", planError);
  const planMismatches = (plans || []).filter((plan) =>
    (plan.room_id && String(plan.hotel_slug) !== String(plan.rooms?.hotel_slug)) ||
    (plan.room_type_id && String(plan.hotel_slug) !== String(plan.room_types?.hotel_slug))
  );
  return {
    refundMismatches: refundMismatches.map((row) => row.id),
    ratePlanMismatches: planMismatches.map((row) => row.id)
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  await Promise.all([
    selectColumns(supabase, "hotel_room_tax_settings", [
      "hotel_slug", "is_configured", "gst_enabled", "gst_registered", "gstin",
      "state_code", "accommodation_sac", "default_tax_mode", "rounding_rule", "version"
    ]),
    selectColumns(supabase, "room_tax_rules", [
      "id", "hotel_slug", "minimum_taxable_value", "maximum_taxable_value",
      "cgst_rate", "sgst_rate", "igst_rate", "cess_rate", "is_exempt",
      "exemption_reason", "effective_from", "effective_to", "status", "version"
    ]),
    selectColumns(supabase, "room_bookings", [
      "id", "hotel_slug", "tax_rule_id", "tax_snapshot", "pricing_snapshot",
      "pricing_version", "guest_company_name", "guest_gstin", "guest_place_of_supply"
    ]),
    selectColumns(supabase, "room_rate_plans", [
      "id", "hotel_slug", "room_id", "room_type_id", "status", "version",
      "start_date", "end_date", "nightly_price"
    ]),
    selectColumns(supabase, "room_booking_payments", [
      "id", "hotel_slug", "booking_id", "amount", "idempotency_key"
    ]),
    selectColumns(supabase, "room_booking_refunds", [
      "id", "hotel_slug", "booking_id", "amount", "idempotency_key", "tax_adjustment_snapshot"
    ]),
    selectColumns(supabase, "room_stay_rate_adjustments", [
      "id", "hotel_slug", "booking_id", "adjustment_type", "effective_from",
      "effective_to", "base_amount", "tax_amount", "tax_snapshot"
    ])
  ]);

  const [taxAudit, scopeAudit] = await Promise.all([
    auditActiveTaxRules(supabase),
    auditForeignScope(supabase)
  ]);
  const problems = [
    ...taxAudit.conflicts.map((value) => `overlapping active GST rules: ${value}`),
    ...scopeAudit.refundMismatches.map((id) => `refund ${id} has a hotel-scope mismatch`),
    ...scopeAudit.ratePlanMismatches.map((id) => `rate plan ${id} has a hotel-scope mismatch`)
  ];
  if (problems.length) {
    problems.forEach((problem) => console.error(`FAIL ${problem}`));
    process.exitCode = 1;
    return;
  }

  console.log("Production Room PMS live schema verification passed.");
  console.log(`Active GST rules audited: ${taxAudit.count}${taxAudit.truncated ? " (sample limit reached)" : ""}`);
  console.log("Room GST, booking snapshots, effective rates, payment retries, refunds, and adjustment tables are queryable.");
  console.log("No active GST overlaps or sampled cross-hotel references were found.");
  console.log("No database writes were made.");
}

main().catch((error) => {
  console.error(`Production Room PMS live verification failed: ${error.message}`);
  process.exitCode = 1;
});
