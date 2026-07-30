"use strict";

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const ROOM_BOOKING_COLUMNS = [
  "id",
  "hotel_slug",
  "room_id",
  "total_amount",
  "advance_paid",
  "balance_amount",
  "booking_status",
  "payment_status"
];

const ROOM_PAYMENT_COLUMNS = [
  "id",
  "hotel_slug",
  "booking_id",
  "amount",
  "payment_method",
  "payment_status",
  "transaction_id",
  "paid_at"
];

const ORDER_COLUMNS = [
  "id",
  "hotel_slug",
  "status",
  "items",
  "totals",
  "payment_status",
  "billing_status",
  "paid_at",
  "billed_at",
  "room_id",
  "room_booking_id",
  "room_service_charge_to_room"
];

function formatError(error = {}) {
  return `${error.code || "UNKNOWN"} ${error.message || ""}`.trim();
}

function getRuntimeIdShape(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? "safe JavaScript integer" : "unsafe JavaScript number";
  }

  const text = String(value || "").trim();
  if (!text) return "no sample";
  if (/^\d+$/.test(text)) return "numeric string";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    return "UUID-like string";
  }

  return "text string";
}

async function verifyTableColumns(supabase, tableName, columns) {
  const { data, error } = await supabase
    .from(tableName)
    .select(columns.join(","))
    .limit(1);

  if (error) {
    throw new Error(`${tableName} checkout columns are not ready: ${formatError(error)}`);
  }

  return Array.isArray(data) ? data : [];
}

async function auditLinkedRoomServiceOrders(supabase) {
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id,hotel_slug,room_booking_id,room_id,room_service_charge_to_room")
    .not("room_booking_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (ordersError) {
    throw new Error(`Linked room-service order audit failed: ${formatError(ordersError)}`);
  }

  const linkedOrders = Array.isArray(orders) ? orders : [];
  const bookingIds = linkedOrders
    .map((order) => order.room_booking_id)
    .filter((value, index, list) => value !== null && value !== undefined && list.indexOf(value) === index);

  if (!bookingIds.length) {
    return {
      linkedOrderCount: 0,
      mismatches: [],
      orderIdShape: linkedOrders.length ? getRuntimeIdShape(linkedOrders[0].id) : "no sample"
    };
  }

  const { data: bookings, error: bookingsError } = await supabase
    .from("room_bookings")
    .select("id,hotel_slug,room_id")
    .in("id", bookingIds);

  if (bookingsError) {
    throw new Error(`Linked booking audit failed: ${formatError(bookingsError)}`);
  }

  const bookingsById = new Map(
    (bookings || []).map((booking) => [String(booking.id), booking])
  );
  const mismatches = [];

  linkedOrders.forEach((order) => {
    const booking = bookingsById.get(String(order.room_booking_id));

    if (!booking) {
      mismatches.push(`order ${order.id}: linked booking was not found`);
      return;
    }

    if (String(order.hotel_slug || "") !== String(booking.hotel_slug || "")) {
      mismatches.push(`order ${order.id}: hotel scope does not match linked booking`);
    }

    if (
      order.room_id !== null &&
      order.room_id !== undefined &&
      String(order.room_id) !== String(booking.room_id)
    ) {
      mismatches.push(`order ${order.id}: room does not match linked booking`);
    }
  });

  return {
    linkedOrderCount: linkedOrders.length,
    mismatches,
    orderIdShape: getRuntimeIdShape(linkedOrders[0]?.id)
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Room checkout readiness check skipped: missing Supabase environment values.");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const [bookingRows, paymentRows, orderRows] = await Promise.all([
    verifyTableColumns(supabase, "room_bookings", ROOM_BOOKING_COLUMNS),
    verifyTableColumns(supabase, "room_booking_payments", ROOM_PAYMENT_COLUMNS),
    verifyTableColumns(supabase, "orders", ORDER_COLUMNS)
  ]);
  const audit = await auditLinkedRoomServiceOrders(supabase);

  if (audit.mismatches.length) {
    console.log("Room checkout readiness check failed.");
    audit.mismatches.forEach((mismatch) => console.log(`- ${mismatch}`));
    process.exit(1);
  }

  console.log("Room checkout data prerequisites look ready.");
  console.log(`Room booking columns: ${ROOM_BOOKING_COLUMNS.join(", ")}`);
  console.log(`Room payment columns: ${ROOM_PAYMENT_COLUMNS.join(", ")}`);
  console.log(`Order columns: ${ORDER_COLUMNS.join(", ")}`);
  console.log(`Linked room-service orders audited: ${audit.linkedOrderCount}`);
  console.log(`PostgREST order id runtime shape: ${audit.orderIdShape}`);
  console.log(`Sample rows: bookings=${bookingRows.length}, payments=${paymentRows.length}, orders=${orderRows.length}`);
  console.log("No database writes were made.");
}

main().catch((error) => {
  console.error(`Room checkout readiness check failed: ${error.message}`);
  process.exit(1);
});