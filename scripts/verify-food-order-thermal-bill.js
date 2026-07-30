"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildDefaultFoodBillFormat,
  buildFoodBillFormatRow,
  buildTotals,
  getFoodBillDocumentStatus,
  getSourceMeta,
  getTrustedOrderTotal,
  mapFoodBillFormatRow,
  overlayFoodBillLifecycle
} = require("../utils/food-order-bill");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const migration = read("backend/scripts/create-food-order-thermal-bill.sql");
const rollback = read("backend/scripts/rollback-food-order-thermal-bill.sql");
const route = read("backend/routes/staff-food-order-bill.js");
const validator = read("backend/validators/food-order-bill.js");
const utility = read("backend/utils/food-order-bill.js");
const server = read("backend/server.js");
const staffRoute = read("backend/routes/staff.js");
const html = read("frontend/staff-orders.html");
const staffJs = read("frontend/js/staff-orders.js");
const receiptJs = read("frontend/js/food-order-receipt.js");
const settingsJs = read("frontend/js/food-order-bill-settings.js");
const css = read("frontend/css/food-order-receipt.css");

function verifyPureContracts() {
  assert.equal(getTrustedOrderTotal({ normalTotal: 120, total: 110, gpayFinalTotal: 100 }), 100);
  assert.equal(getTrustedOrderTotal({ normalTotal: 120, total: 110 }), 110);
  assert.equal(getTrustedOrderTotal({ normalTotal: 120 }), 120);
  assert.equal(getTrustedOrderTotal({}), null);

  assert.equal(getSourceMeta({ order_source: "staff", table_number: "T1" }).key, "staff_table");
  assert.equal(getSourceMeta({ order_source: "qr", table_number: "T2" }).key, "qr_table");
  assert.equal(getSourceMeta({ order_source: "room_service" }).key, "room_service");
  assert.equal(getSourceMeta({ order_source: "takeaway" }).key, "takeaway");
  assert.equal(getSourceMeta({ order_source: "delivery" }).key, "delivery");
  assert.equal(getSourceMeta({ totals: { deliveryCharge: 50 } }).key, "delivery");
  assert.equal(getSourceMeta({}).key, "website");

  const unpaid = buildTotals({
    payment_status: "unpaid",
    totals: {
      subtotal: 1000,
      gst: 50,
      gstPercent: 5,
      deliveryCharge: 40,
      gpayDiscount: 90,
      gpayFinalTotal: 1000
    }
  });
  assert.equal(unpaid.itemSubtotal, 1000);
  assert.equal(unpaid.deliveryCharge, 40);
  assert.equal(unpaid.upiDiscount, 90);
  assert.equal(unpaid.grandTotal, 1000);
  assert.equal(unpaid.paid, 0);
  assert.equal(unpaid.balance, 1000);
  assert.deepEqual(unpaid.taxes, [{ label: "GST (5%)", amount: 50 }]);

  const paid = buildTotals({
    payment_status: "paid",
    totals: { total: 744, paid: 0, balance: 744 }
  });
  assert.equal(paid.paid, 744);
  assert.equal(paid.balance, 0);

  const refunded = buildTotals({
    payment_status: "refunded",
    totals: { total: 744 }
  });
  assert.equal(refunded.paid, 744);
  assert.equal(refunded.refund, 744);
  assert.equal(refunded.balance, 0);

  assert.equal(
    getFoodBillDocumentStatus({
      status: "preparing",
      billing_status: "billed",
      payment_status: "unpaid"
    }),
    "billed"
  );
  assert.equal(
    getFoodBillDocumentStatus({
      status: "preparing",
      billing_status: "billed",
      payment_status: "paid"
    }),
    "paid"
  );

  const synchronizedBill = overlayFoodBillLifecycle(
    {
      immutable: true,
      orderStatus: "preparing",
      paymentStatus: "unpaid",
      billingStatus: "billed",
      totals: { grandTotal: 500, paid: 0, refund: 0, balance: 500 },
      payments: [],
      relatedOrders: []
    },
    {
      order: {
        id: "42",
        status: "preparing",
        billing_status: "billed",
        payment_status: "paid",
        payment_method: "COD",
        paid_at: "2026-07-28T10:00:00.000Z",
        totals: { total: 500, paid: 0, balance: 500 }
      },
      relatedOrders: []
    }
  );
  assert.equal(synchronizedBill.immutable, true);
  assert.equal(synchronizedBill.orderStatus, "paid");
  assert.equal(synchronizedBill.operationalOrderStatus, "preparing");
  assert.equal(synchronizedBill.paymentStatus, "paid");
  assert.equal(synchronizedBill.billingStatus, "billed");
  assert.equal(synchronizedBill.totals.paid, 500);
  assert.equal(synchronizedBill.totals.balance, 0);
  assert.equal(synchronizedBill.payments[0].status, "paid");

  const defaults = buildDefaultFoodBillFormat(
    {
      hotel_name: "Hotel A",
      contact: { phone: "123", website: "https://hotel-a.test" },
      branding: { logoUrl: "https://hotel-a.test/logo.png" }
    },
    {},
    "hotel-a"
  );
  assert.equal(defaults.hotelSlug, "hotel-a");
  assert.equal(defaults.companyName, "Hotel A");
  assert.equal(defaults.qr.value, "https://hotel-a.test");
  assert.equal(defaults.paperWidth, "80");

  const mapped = mapFoodBillFormatRow(
    {
      hotel_slug: "hotel-a",
      paper_width: "58",
      company_name: "Hotel A",
      restaurant_name: "Outlet A",
      labels_json: { invoice: "Tax Invoice" },
      privacy_json: {},
      display_json: {},
      qr_json: {},
      print_json: {},
      messages_json: {},
      version: 4
    },
    {},
    {},
    "hotel-a"
  );
  assert.equal(mapped.hotelSlug, "hotel-a");
  assert.equal(mapped.paperWidth, "58");
  assert.equal(mapped.labels.invoice, "Tax Invoice");
  assert.equal(mapped.version, 4);

  const row = buildFoodBillFormatRow("hotel-a", {
    companyName: "<Hotel A>",
    paperWidth: "58",
    messages: { footer: "Safe text" }
  });
  assert.equal(row.hotel_slug, "hotel-a");
  assert.equal(row.paper_width, "58");
  assert.equal(row.messages_json.footer, "Safe text");
  assert.equal(row.is_active, true);
}

function verifyDatabaseContracts() {
  assert.match(migration, /create table if not exists public\.food_order_bill_formats/i);
  assert.match(migration, /unique \(hotel_slug\)/i);
  assert.match(migration, /where is_active/i);
  assert.match(migration, /create table if not exists public\.food_order_bill_snapshots/i);
  assert.match(migration, /unique \(hotel_slug, order_id\)/i);
  assert.match(migration, /payload_hash ~ '\^\[a-f0-9\]\{64\}\$'/i);
  assert.match(migration, /Issued food order bill snapshots are immutable/i);
  assert.match(migration, /reprint count cannot decrease/i);
  assert.match(migration, /create table if not exists public\.food_order_bill_audit/i);
  assert.match(migration, /revoke all .* from anon, authenticated/is);
  assert.match(rollback, /drop table if exists public\.food_order_bill_audit/i);
  assert.match(rollback, /drop table if exists public\.food_order_bill_snapshots/i);
  assert.match(rollback, /drop table if exists public\.food_order_bill_formats/i);
}

function verifySecurityAndApiContracts() {
  assert.match(route, /router\.use\(requireStaffAuth, requireFoodModule, requireStaffManagerAccess\)/);
  assert.match(route, /requireHotelFeature\("food"/);
  assert.match(route, /req\.staffHotelSlug/);
  assert.doesNotMatch(route, /req\.body\?\.(hotel_id|hotelId|tenant_id|tenantId|hotelSlug)/);
  assert.match(utility, /\.eq\("id", orderId\)[\s\S]*?\.eq\("hotel_slug", hotelSlug\)/);
  assert.match(utility, /\.eq\("hotel_slug", hotelSlug\)[\s\S]*?\.eq\("parent_order_id", String\(order\.id\)\)/);
  assert.match(utility, /\.eq\("hotel_slug", order\.hotel_slug\)[\s\S]*?\.eq\("booking_id", order\.room_booking_id\)/);
  assert.match(route, /router\.get\("\/orders\/:id"/);
  assert.match(route, /router\.post\([\s\S]*?"\/orders\/:id\/reprint"/);
  assert.match(route, /"\/orders\/:id\/audit"/);
  assert.match(route, /"\/format\/preview"/);
  assert.match(route, /"\/format\/test-print"/);
  assert.match(server, /app\.use\("\/api\/staff\/food-order-bill", staffFoodOrderBillRoute\)/);
  assert.match(validator, /URL must use https:\/\//);
  assert.doesNotMatch(validator, /custom(JavaScript|Css|CSS)/);
  assert.doesNotMatch(utility, /gateway_signature|payment_metadata|CVV|card_number/i);
  assert.match(utility, /maskReference\(order\.gateway_payment_id/);
}

function verifySnapshotAndRoomServiceContracts() {
  assert.match(utility, /fetchFoodBillSnapshot\(supabaseClient, hotelSlug, orderId\)/);
  assert.match(utility, /if \(existing\) \{[\s\S]*?overlayFoodBillLifecycle\(mapFoodBillSnapshot\(existing\), lifecycleSource\)/);
  assert.match(utility, /FOOD_BILL_LIFECYCLE_FIELDS[\s\S]*?\.eq\("hotel_slug", hotelSlug\)/);
  assert.match(utility, /food_bill_issued/);
  assert.match(utility, /food_bill_reprinted/);
  assert.match(utility, /reprint_count: nextCount/);
  assert.match(utility, /room_service_charge_to_room/);
  assert.match(utility, /contains\("settled_order_ids", \[String\(order\.id\)\]\)/);
  assert.match(utility, /pending_room_charge/);
  assert.match(utility, /separate_food_bill/);
  assert.match(staffRoute, /issueFoodBillSnapshotIfFinal/);
  assert.match(staffRoute, /foodBillSnapshotReady/);
  assert.match(staffRoute, /foodBillSnapshotsReady/);
}

function verifyFrontendContracts() {
  assert.match(html, /id="staffFoodBillFormatBtn"[\s\S]*?data-staff-manager-only hidden/);
  assert.match(html, /css\/food-order-receipt\.css/);
  assert.match(html, /js\/food-order-receipt\.js/);
  assert.match(html, /js\/food-order-bill-settings\.js/);
  assert.match(staffJs, /function openStaffOrderBill\(order = \{\}\)/);
  assert.match(staffJs, /food-order-bill\/orders/);
  assert.match(staffJs, /window\.FoodOrderReceipt\.openLoading/);
  assert.match(staffJs, /window\.FoodOrderReceipt\.showBill/);
  assert.doesNotMatch(
    staffJs.slice(staffJs.indexOf("async function loadStaffFoodOrderBill"), staffJs.indexOf("function getStaffOrderCreatedByLabel")),
    /location\.reload/
  );
  assert.match(receiptJs, /data-food-bill-print/);
  assert.match(receiptJs, /data-food-bill-download/);
  assert.match(receiptJs, /data-food-bill-reprint/);
  assert.match(receiptJs, /data-food-bill-close/);
  assert.match(receiptJs, /data-food-bill-retry/);
  assert.match(receiptJs, /PROVISIONAL - NOT A FINAL TAX INVOICE/);
  assert.match(receiptJs, /<strong>Bill Status<\/strong>/);
  assert.match(receiptJs, /Additional orders \(billed separately\)/);
  assert.match(receiptJs, /Transferred to Room Folio/);
  assert.match(receiptJs, /Pending Room Charge/);
  assert.doesNotMatch(receiptJs, /location\.reload/);
  assert.match(settingsJs, /Save &amp; Set Active/);
  assert.match(settingsJs, /data-food-bill-format-preview/);
  assert.match(settingsJs, /data-food-bill-format-test-print/);
  assert.match(settingsJs, /data-food-bill-format-reset/);
  assert.match(settingsJs, /format\?preview=true/);
  assert.doesNotMatch(settingsJs, /Paneer|Actual Hotel|sample/i);
}

function verifyPrintAndResponsiveContracts() {
  assert.match(css, /\.food-receipt-paper\.is-58mm/);
  assert.match(css, /width: min\(100%, 80mm\)/);
  assert.match(receiptJs, /@page \{ size: \$\{width\}mm auto/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media print/);
  assert.match(css, /\[data-food-receipt\]/);
  assert.match(css, /break-inside: avoid/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.match(css, /\.food-receipt-dialog[\s\S]*?max-height: calc\(100dvh - 24px\)/);
}

verifyPureContracts();
verifyDatabaseContracts();
verifySecurityAndApiContracts();
verifySnapshotAndRoomServiceContracts();
verifyFrontendContracts();
verifyPrintAndResponsiveContracts();

console.log("Food Order Thermal Bill verification passed.");
console.log("Verified hotel scoping, immutable snapshots with live settlement state, reprints, room-service transfer state, stored totals, 58/80mm print, responsive preview, and owner-only configuration.");
