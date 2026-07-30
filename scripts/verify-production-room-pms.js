"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { calculateRoomTaxFromRule, calculateRoomTaxSchedule } = require("../utils/room-tax");
const { buildRoomRefundCreditNote } = require("../utils/room-credit-note");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const readBackend = (relativePath) => fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
const readProject = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const results = [];

function check(name, run) {
  try {
    run();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

check("exclusive intrastate GST splits CGST and SGST deterministically", () => {
  const tax = calculateRoomTaxFromRule({
    amount: 1000,
    rule: { cgst_rate: 9, sgst_rate: 9, igst_rate: 18, cess_rate: 0, tax_inclusive: false },
    settings: { default_supply_type: "intrastate", default_tax_mode: "exclusive", rounding_rule: "half_up" }
  });
  assert.deepStrictEqual(tax.components, {
    cgst: { rate: 9, amount: 90 },
    sgst: { rate: 9, amount: 90 }
  });
  assert.strictEqual(tax.taxableValue, 1000);
  assert.strictEqual(tax.totalTax, 180);
  assert.strictEqual(tax.totalAmount, 1180);
});

check("inclusive GST preserves guest total and derives taxable value", () => {
  const tax = calculateRoomTaxFromRule({
    amount: 1180,
    rule: { cgst_rate: 9, sgst_rate: 9, tax_inclusive: true },
    settings: { default_supply_type: "intrastate", default_tax_mode: "inclusive", rounding_rule: "half_up" }
  });
  assert.strictEqual(tax.taxableValue, 1000);
  assert.strictEqual(tax.totalTax, 180);
  assert.strictEqual(tax.totalAmount, 1180);
});

check("rule tax mode overrides the hotel default tax mode", () => {
  const tax = calculateRoomTaxFromRule({
    amount: 1000,
    rule: { cgst_rate: 9, sgst_rate: 9, tax_inclusive: false },
    settings: { default_supply_type: "intrastate", default_tax_mode: "inclusive", rounding_rule: "half_up" }
  });
  assert.strictEqual(tax.taxMode, "exclusive");
  assert.strictEqual(tax.taxableValue, 1000);
  assert.strictEqual(tax.totalTax, 180);
  assert.strictEqual(tax.totalAmount, 1180);
});

check("interstate supply uses IGST instead of CGST and SGST", () => {
  const tax = calculateRoomTaxFromRule({
    amount: 1000,
    rule: { cgst_rate: 9, sgst_rate: 9, igst_rate: 18 },
    settings: { default_supply_type: "interstate", default_tax_mode: "exclusive", rounding_rule: "half_up" }
  });
  assert.deepStrictEqual(tax.components, { igst: { rate: 18, amount: 180 } });
  assert.strictEqual(tax.totalAmount, 1180);
});

check("nearest-rupee rounding remains explicitly reconcilable", () => {
  const tax = calculateRoomTaxFromRule({
    amount: 100.45,
    rule: { cgst_rate: 9, sgst_rate: 9 },
    settings: { default_supply_type: "intrastate", default_tax_mode: "exclusive", rounding_rule: "nearest_rupee" }
  });
  assert.strictEqual(tax.totalAmount, 119);
  assert.strictEqual(
    Math.round((tax.taxableValue + tax.totalTax + tax.roundingAdjustment) * 100),
    Math.round(tax.totalAmount * 100)
  );
});

check("exempt Room supplies remain tax-free and retain the exemption reason", () => {
  const tax = calculateRoomTaxFromRule({
    amount: 1000,
    rule: {
      cgst_rate: 0,
      sgst_rate: 0,
      igst_rate: 0,
      is_exempt: true,
      exemption_reason: "Government-notified exemption"
    },
    settings: { default_supply_type: "intrastate", default_tax_mode: "exclusive", rounding_rule: "half_up" }
  });
  assert.deepStrictEqual(tax.components, {});
  assert.strictEqual(tax.totalTax, 0);
  assert.strictEqual(tax.totalAmount, 1000);
  assert.strictEqual(tax.exempt, true);
  assert.strictEqual(tax.exemptionReason, "Government-notified exemption");
});

check("night-wise GST follows effective dates and each night's transaction value", () => {
  const snapshots = calculateRoomTaxSchedule({
    lines: [
      { amount: 1000, effectiveDate: "2026-03-31" },
      { amount: 2000, effectiveDate: "2026-04-01" }
    ],
    settings: {
      is_configured: true,
      gst_enabled: true,
      default_supply_type: "intrastate",
      default_tax_mode: "exclusive",
      rounding_rule: "half_up",
      currency: "INR"
    },
    rules: [
      {
        id: 2,
        version: 1,
        rule_name: "New rule",
        effective_from: "2026-04-01",
        minimum_taxable_value: 0,
        cgst_rate: 6,
        sgst_rate: 6
      },
      {
        id: 1,
        version: 4,
        rule_name: "Old rule",
        effective_from: "2025-04-01",
        effective_to: "2026-03-31",
        minimum_taxable_value: 0,
        cgst_rate: 9,
        sgst_rate: 9
      }
    ]
  });
  assert.deepStrictEqual(snapshots.map((snapshot) => snapshot.ruleId), [1, 2]);
  assert.deepStrictEqual(snapshots.map((snapshot) => snapshot.totalTax), [180, 240]);
  assert.deepStrictEqual(snapshots.map((snapshot) => snapshot.totalAmount), [1180, 2240]);
});

check("shared pricing service owns Room tax and immutable snapshots", () => {
  const source = readBackend("utils/room-pricing.js");
  assert.match(source, /require\("\.\/room-tax"\)/);
  assert.match(source, /resolveRoomTaxes\(/);
  assert.match(source, /taxSnapshot/);
  assert.match(source, /pricingVersion: negotiatedRateApplied \? 4 : 3/);
  assert.match(source, /nightlyRates/);
  assert.match(source, /nightlyTaxes/);
  assert.match(source, /candidate\.room_id/);
  assert.doesNotMatch(source, /roomPrice \* taxPercent \/ 100/);
});

check("all booking entry points persist guarded GST and pricing snapshots", () => {
  for (const file of [
    "routes/public-room-booking.js",
    "routes/staff-room-booking.js",
    "routes/admin-room-booking.js"
  ]) {
    const source = readBackend(file);
    assert.match(source, /totals\.taxSnapshot\?\.supportsTaxSnapshot/);
    assert.match(source, /bookingPayload\.tax_rule_id = totals\.taxRuleId/);
    assert.match(source, /bookingPayload\.pricing_version = totals\.pricingVersion/);
    assert.match(source, /guest_place_of_supply/);
  }
});

check("Manager route enforces price locks and hotel-scoped GST lifecycle", () => {
  const source = readBackend("routes/staff-room-management.js");
  const managerGate = source.indexOf("router.use(requireStaffManagerAccess)");
  for (const token of [
    'router.put("/tax/settings"',
    'router.post("/tax/rules"',
    'router.post("/tax/preview"',
    'router.patch("/room-types/:id"',
    'router.patch("/rooms/:id"'
  ]) {
    const position = source.indexOf(token);
    assert.ok(position > managerGate, `${token} must remain behind the Manager gate`);
  }
  assert.match(source, /ROOM_PRICE_PERIOD_CONFLICT/);
  assert.match(source, /ROOM_TYPE_PRICE_PERIOD_CONFLICT/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /optionalRoomRefunds/);
});

check("migration supplies locks, versions, atomic finance, adjustments and rollback", () => {
  const upgrade = readBackend("scripts/upgrade-production-room-pricing-gst.sql");
  const rollback = readBackend("scripts/rollback-production-room-pricing-gst.sql");
  for (const token of [
    "hotel_room_tax_settings",
    "room_tax_rules",
    "room_booking_refunds",
    "room_stay_rate_adjustments",
    "protect_room_booking_snapshots",
    "protect_room_master_financial_change",
    "protect_room_type_financial_change",
    "protect_room_rate_plan_change",
    "activate_room_tax_rule",
    "record_room_booking_payment",
    "record_room_booking_refund",
    "pg_advisory_xact_lock",
    "enable row level security"
  ]) assert.ok(upgrade.includes(token), `upgrade missing ${token}`);
  assert.doesNotMatch(upgrade, /'Infinity'::numeric/);
  assert.match(upgrade, /^begin;/m);
  assert.match(upgrade, /^commit;/m);
  assert.match(rollback, /drop table if exists public\.room_tax_rules/);
  assert.match(rollback, /create or replace function public\.extend_room_booking/);
});

check("payments and refunds are idempotent from UI through database RPC", () => {
  const staffRoute = readBackend("routes/staff-room-booking.js");
  const migration = readBackend("scripts/upgrade-production-room-pricing-gst.sql");
  const staffUi = readProject("frontend/js/staff-orders.js");
  const adminUi = readProject("frontend/js/admin.js");
  assert.match(staffRoute, /record_room_booking_payment/);
  assert.match(staffRoute, /record_room_booking_refund/);
  assert.match(migration, /uq_room_booking_payments_scope_idempotency/);
  assert.match(migration, /ROOM_PAYMENT_IDEMPOTENCY_SCOPE_CONFLICT/);
  assert.match(migration, /ROOM_REFUND_IDEMPOTENCY_SCOPE_CONFLICT/);
  const paymentFunction = migration.slice(
    migration.indexOf("create or replace function public.record_room_booking_payment"),
    migration.indexOf("create or replace function public.extend_room_booking")
  );
  const refundFunction = migration.slice(
    migration.indexOf("create or replace function public.record_room_booking_refund"),
    migration.indexOf("revoke all on function public.activate_room_tax_rule")
  );
  assert.ok(
    paymentFunction.indexOf("for update") < paymentFunction.indexOf("idempotency_key=p_idempotency_key"),
    "payment booking lock must precede idempotency lookup"
  );
  assert.ok(
    refundFunction.indexOf("for update") < refundFunction.indexOf("idempotency_key=p_idempotency_key"),
    "refund booking lock must precede idempotency lookup"
  );
  assert.match(staffUi, /room-payment-/);
  assert.match(staffUi, /room-refund-/);
  assert.match(adminUi, /room-payment-/);
});

check("Room bill uses snapshotted tax lines and preserves issued bills", () => {
  const bill = readBackend("utils/room-checkout-bill.js");
  assert.match(bill, /taxLinesFromSnapshot/);
  assert.match(bill, /booking\.pricing_snapshot\?\.taxSnapshot/);
  assert.match(bill, /room_booking_refunds/);
  assert.match(bill, /snapshotVersion: 2/);
  assert.match(bill, /if \(existing\)/);
});

check("refund credit notes reverse snapshotted tax without mutating the bill", () => {
  const note = buildRoomRefundCreditNote({
    booking: {
      id: 42,
      hotel_slug: "demo-hotel",
      total_amount: 1180,
      tax_rule_id: 7,
      tax_snapshot: {
        currency: "INR",
        taxableValue: 1000,
        ruleVersion: 3,
        components: {
          cgst: { rate: 9, amount: 90 },
          sgst: { rate: 9, amount: 90 }
        }
      }
    },
    refund: { id: 9, amount: 590, reason: "Approved partial refund" }
  });
  assert.strictEqual(note.refundAmount, 590);
  assert.strictEqual(note.taxReversal, 90);
  assert.strictEqual(note.taxableValueReversal, 500);
  assert.strictEqual(note.immutableSource, true);
  assert.strictEqual(note.originalTaxRuleVersion, 3);
  assert.match(note.creditNoteNumber, /^CN-DEMO-HOTEL-9$/);
  const route = readBackend("routes/staff-room-booking.js");
  assert.match(route, /refunds\/:refundId\/credit-note/);
  assert.match(route, /requireStaffManagerAccess/);
});

check("Manager UI exposes effective rates, GST settings, preview and activation", () => {
  const html = readProject("frontend/staff-orders.html");
  const js = readProject("frontend/js/room-operations-manager.js");
  for (const id of [
    "staffRatePlanStartInput",
    "staffRatePlanEndInput",
    "staffRoomTaxSettingsForm",
    "staffRoomTaxRuleForm"
  ]) assert.ok(html.includes(id), `UI missing ${id}`);
  assert.match(js, /room-management\/tax\/settings/);
  assert.match(js, /room-management\/tax\/preview/);
  assert.match(js, /data-room-tax-activate/);
});

const failures = results.filter((result) => !result.ok);
console.log(`\nProduction Room PMS checks: ${results.length - failures.length}/${results.length} passed.`);
if (failures.length) process.exitCode = 1;
