"use strict";

const fs = require("fs");
const path = require("path");

const backendRoot = path.resolve(__dirname, "..");
const migrationPath = path.join(__dirname, "create-room-combined-checkout.sql");
const adminRoutePath = path.join(backendRoot, "routes", "admin-room-booking.js");
const staffRoutePath = path.join(backendRoot, "routes", "staff-room-booking.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  const migration = read(migrationPath);
  const adminRoute = read(adminRoutePath);
  const staffRoute = read(staffRoutePath);
  const failures = [];
  const checks = [
    ["receipt ledger", /create table if not exists public\.room_checkout_receipts/i],
    ["allocation invariant", /amount\s*=\s*room_amount\s*\+\s*food_amount/i],
    ["tenant idempotency key", /unique\s*\(\s*hotel_slug,\s*idempotency_key\s*\)/i],
    ["booking-link trigger", /create trigger orders_validate_room_service_booking_link/i],
    ["charge-to-room trigger coverage", /update of hotel_slug,\s*room_id,\s*room_booking_id,\s*room_service_charge_to_room/i],
    ["booking link row lock", /for key share/i],
    ["checked-in trigger guard", /v_booking\.booking_status\s*<>\s*'checked_in'/i],
    ["atomic checkout function", /function public\.settle_room_combined_checkout/i],
    ["security invoker", /security invoker/i],
    ["booking update lock", /from public\.room_bookings[\s\S]*for update;/i],
    ["backend amount check", /v_requested_amount\s*<>\s*v_final_due/i],
    ["room payment allocation", /insert into public\.room_booking_payments/i],
    ["food payment update", /update public\.orders as target/i],
    ["booking checkout update", /booking_status\s*=\s*'checked_out'/i],
    ["concurrent order count check", /v_updated_order_count\s*<>\s*jsonb_array_length\(v_order_ids\)/i],
    ["anonymous execution revocation", /from public,\s*anon,\s*authenticated/i],
    ["service-role execution grant", /grant execute on function public\.settle_room_combined_checkout[\s\S]*to service_role;/i]
  ];

  checks.forEach(([label, pattern]) => {
    if (!pattern.test(migration)) failures.push(`${label} is missing`);
  });

  if (/references\s+public\.orders\s*\(/i.test(migration)) {
    failures.push("migration adds a blind foreign key to the repository-undefined orders.id type");
  }

  if (/\.rpc\(\s*["']settle_room_combined_checkout["']/i.test(adminRoute)) {
    failures.push("admin route calls the dormant checkout RPC");
  }

  if (/\.rpc\(\s*["']settle_room_combined_checkout["']/i.test(staffRoute)) {
    failures.push("staff route calls the dormant checkout RPC");
  }

  if (failures.length) {
    console.log("Combined checkout migration verification failed.");
    failures.forEach((failure) => console.log(`- ${failure}`));
    process.exit(1);
  }

  console.log("Combined checkout migration safety contract looks ready for review.");
  console.log("Verified ledger allocation, idempotency, booking/order locks, tenant guards, and service-role-only RPC access.");
  console.log("Verified route files do not bypass the feature-gated adapter with direct RPC calls.");
  console.log("No database or network access was used.");
}

main();