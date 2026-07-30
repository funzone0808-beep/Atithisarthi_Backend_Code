"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
require("dotenv").config({ path: path.join(root, "backend", ".env"), quiet: true });

const { supabase } = require("../utils/supabase");
const { signStaffToken } = require("../utils/auth");

const baseUrl = new URL(
  process.env.FOOD_BILL_VERIFY_BASE_URL || "http://127.0.0.1:5000"
);

async function fetchBill(orderId, token) {
  const response = await fetch(
    new URL(`/api/staff/food-order-bill/orders/${encodeURIComponent(orderId)}`, baseUrl),
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(10_000)
    }
  );
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function main() {
  const snapshotResult = await supabase
    .from("food_order_bill_snapshots")
    .select("order_id,hotel_slug")
    .order("issued_at", { ascending: false })
    .limit(200);
  assert.ifError(snapshotResult.error);
  assert.ok(snapshotResult.data?.length, "No food bill snapshot is available for live verification");

  const snapshotOrderIds = snapshotResult.data.map((row) => row.order_id);
  const ordersResult = await supabase
    .from("orders")
    .select("id,hotel_slug,status,payment_status,billing_status")
    .in("id", snapshotOrderIds)
    .eq("payment_status", "paid")
    .eq("billing_status", "billed")
    .limit(100);
  assert.ifError(ordersResult.error);
  assert.ok(
    ordersResult.data?.length,
    "No paid-and-billed order with a stored food bill snapshot is available"
  );

  const candidates = [...ordersResult.data].sort((left, right) => {
    const leftPreparing = String(left.status || "").toLowerCase() === "preparing" ? 0 : 1;
    const rightPreparing = String(right.status || "").toLowerCase() === "preparing" ? 0 : 1;
    return leftPreparing - rightPreparing;
  });

  const staffResult = await supabase
    .from("hotel_staff_access")
    .select("id,hotel_slug,display_name,role,kds_role,is_active")
    .eq("is_active", true);
  assert.ifError(staffResult.error);

  let selected = null;
  let manager = null;
  for (const candidate of candidates) {
    const matchingManager = (staffResult.data || []).find(
      (staff) =>
        String(staff.hotel_slug) === String(candidate.hotel_slug) &&
        String(staff.role || "").trim().toLowerCase() === "owner"
    );
    if (matchingManager) {
      selected = candidate;
      manager = matchingManager;
      break;
    }
  }
  assert.ok(selected && manager, "No active manager can read a paid-and-billed snapshot candidate");

  const billRead = await fetchBill(selected.id, signStaffToken(manager));
  assert.strictEqual(billRead.response.status, 200, "View Bill live read failed");
  assert.strictEqual(billRead.payload.snapshot, true, "Expected an immutable stored snapshot");
  assert.strictEqual(billRead.payload.bill?.immutable, true);
  assert.strictEqual(billRead.payload.bill?.lifecycleLive, true);
  assert.strictEqual(billRead.payload.bill?.paymentStatus, "paid");
  assert.strictEqual(billRead.payload.bill?.billingStatus, "billed");
  assert.strictEqual(billRead.payload.bill?.orderStatus, "paid");
  assert.strictEqual(
    billRead.payload.bill?.operationalOrderStatus,
    String(selected.status || "").trim().toLowerCase()
  );
  assert.strictEqual(Number(billRead.payload.bill?.totals?.balance || 0), 0);
  assert.strictEqual(
    Number(billRead.payload.bill?.totals?.paid || 0),
    Number(billRead.payload.bill?.totals?.grandTotal || 0)
  );

  const otherHotelManager = (staffResult.data || []).find(
    (staff) =>
      String(staff.hotel_slug) !== String(selected.hotel_slug) &&
      String(staff.role || "").trim().toLowerCase() === "owner"
  );
  if (otherHotelManager) {
    const crossHotelRead = await fetchBill(selected.id, signStaffToken(otherHotelManager));
    assert.strictEqual(crossHotelRead.response.status, 404);
  }

  console.log(
    `LIVE View Bill lifecycle: OK (hotel=${selected.hotel_slug}, order=${selected.id}, operational=${selected.status}, billStatus=${billRead.payload.bill.orderStatus}, payment=${billRead.payload.bill.paymentStatus}, billing=${billRead.payload.bill.billingStatus}, balance=${billRead.payload.bill.totals.balance}, cross-tenant=${otherHotelManager ? "denied" : "not available"})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
