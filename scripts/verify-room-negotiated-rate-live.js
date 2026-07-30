"use strict";

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

function fail(message, error = {}) {
  const detail = [error.code, error.message, error.details].filter(Boolean).join(" ");
  throw new Error(detail ? message + ": " + detail : message);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: ready, error: readyError } = await supabase.rpc("room_negotiated_rate_ready");
  if (readyError) fail("Negotiated-rate readiness function is not callable", readyError);
  if (ready !== true) fail("Negotiated-rate trigger is not enabled");

  const { data: approvals, error: approvalError } = await supabase
    .from("room_negotiated_rate_approvals")
    .select([
      "id",
      "hotel_slug",
      "booking_id",
      "configured_taxable_amount",
      "negotiated_taxable_amount",
      "discount_amount",
      "negotiated_nightly_rate",
      "final_total_amount",
      "reason",
      "approved_by",
      "approved_role",
      "pricing_snapshot",
      "room_bookings!inner(hotel_slug,room_price,discount_amount,total_amount,pricing_version)"
    ].join(","))
    .order("id", { ascending: false })
    .limit(1000);
  if (approvalError) fail("Negotiated-rate approval evidence is not queryable", approvalError);

  const problems = [];
  (approvals || []).forEach((approval) => {
    const booking = approval.room_bookings || {};
    const expectedDiscount = Math.round(
      (Number(approval.configured_taxable_amount) - Number(approval.negotiated_taxable_amount)) * 100
    ) / 100;
    if (String(approval.hotel_slug) !== String(booking.hotel_slug)) {
      problems.push("approval " + approval.id + " has a cross-hotel booking reference");
    }
    if (Math.abs(expectedDiscount - Number(approval.discount_amount)) > 0.01) {
      problems.push("approval " + approval.id + " has an unreconciled discount");
    }
    if (Math.abs(Number(approval.discount_amount) - Number(booking.discount_amount)) > 0.01) {
      problems.push("approval " + approval.id + " differs from its booking discount");
    }
    if (Math.abs(Number(approval.final_total_amount) - Number(booking.total_amount)) > 0.01) {
      problems.push("approval " + approval.id + " differs from its booking total");
    }
    if (Number(booking.pricing_version || 0) < 4) {
      problems.push("approval " + approval.id + " is not linked to pricing version 4+");
    }
    if (!String(approval.reason || "").trim() || !String(approval.approved_by || "").trim()) {
      problems.push("approval " + approval.id + " lacks approval attribution");
    }
  });

  if (problems.length) {
    problems.forEach((problem) => console.error("FAIL " + problem));
    process.exitCode = 1;
    return;
  }

  console.log("Room negotiated-rate live verification passed.");
  console.log("Approval rows audited: " + (approvals || []).length + ((approvals || []).length >= 1000 ? " (sample limit reached)" : ""));
  console.log("Readiness trigger, hotel scope, pricing reconciliation, and manager attribution are valid.");
  console.log("No database writes were made.");
}

main().catch((error) => {
  console.error("Room negotiated-rate live verification failed: " + error.message);
  process.exitCode = 1;
});
