"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { staffRoomBookingCreateSchema } = require("../validators/rooms");
const { resolveRoomBookingPricing } = require("../utils/room-pricing");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const readBackend = (file) => fs.readFileSync(path.join(backendRoot, file), "utf8");
const readProject = (file) => fs.readFileSync(path.join(projectRoot, file), "utf8");
const results = [];

async function check(name, run) {
  try {
    await run();
    results.push(true);
    console.log("PASS " + name);
  } catch (error) {
    results.push(false);
    console.error("FAIL " + name + ": " + error.message);
  }
}

function queryResult(data, error = null) {
  const query = {};
  ["select", "eq", "lte", "gte", "or", "order", "limit", "maybeSingle"].forEach((method) => {
    query[method] = () => query;
  });
  query.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return query;
}

function pricingClient(settings, rules = []) {
  return {
    from(table) {
      if (table === "room_rate_plans") return queryResult([]);
      if (table === "hotel_room_tax_settings") return queryResult(settings);
      if (table === "room_tax_rules") return queryResult(rules);
      throw new Error("Unexpected pricing table " + table);
    }
  };
}

const baseBooking = {
  roomId: 101,
  guestName: "Test Guest",
  guestPhone: "9999999999",
  checkInDate: "2026-08-01",
  checkOutDate: "2026-08-02",
  adults: 1,
  children: 0,
  bookingSource: "walk-in"
};

const noTaxSettings = {
  is_configured: true,
  gst_enabled: false,
  default_tax_mode: "exclusive",
  default_supply_type: "intrastate",
  rounding_rule: "half_up",
  currency: "INR",
  version: 1
};

async function main() {
  await check("ordinary manual booking remains valid", () => {
    const result = staffRoomBookingCreateSchema.safeParse(baseBooking);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.negotiatedNightlyRate, undefined);
  });

  await check("negotiated rate requires an approval reason", () => {
    assert.strictEqual(staffRoomBookingCreateSchema.safeParse({
      ...baseBooking,
      negotiatedNightlyRate: 800
    }).success, false);
    assert.strictEqual(staffRoomBookingCreateSchema.safeParse({
      ...baseBooking,
      negotiatedNightlyRate: 800,
      negotiatedRateReason: "Manager-approved loyalty rate"
    }).success, true);
  });

  await check("default pricing remains version 3 and undiscounted", async () => {
    const pricing = await resolveRoomBookingPricing({
      supabaseClient: pricingClient(noTaxSettings),
      hotelSlug: "demo-hotel",
      room: { id: 101, base_price: 1200, tax_percent: 0 },
      checkInDate: "2026-08-01",
      checkOutDate: "2026-08-02"
    });
    assert.deepStrictEqual(
      [pricing.roomPrice, pricing.discountAmount, pricing.totalAmount, pricing.pricingVersion],
      [1200, 0, 1200, 3]
    );
    assert.strictEqual(pricing.pricingSnapshot.negotiatedRate, undefined);
    assert.strictEqual(pricing.pricingSnapshot.configuredPriceSource, undefined);
    assert.strictEqual(pricing.pricingSnapshot.configuredNightlyPrice, undefined);
  });

  await check("1200 rack to 800 negotiated rate produces a 400 discount", async () => {
    const pricing = await resolveRoomBookingPricing({
      supabaseClient: pricingClient(noTaxSettings),
      hotelSlug: "demo-hotel",
      room: { id: 101, base_price: 1200, tax_percent: 0 },
      checkInDate: "2026-08-01",
      checkOutDate: "2026-08-02",
      negotiatedRate: {
        nightlyRate: 800,
        reason: "Manager-approved loyalty rate",
        approvedBy: "manager-1",
        approverRole: "manager"
      }
    });
    assert.deepStrictEqual(
      [pricing.roomPrice, pricing.discountAmount, pricing.totalAmount, pricing.pricingVersion],
      [1200, 400, 800, 4]
    );
    assert.strictEqual(pricing.pricingSnapshot.priceSource, "manager_negotiated_rate");
    assert.strictEqual(pricing.pricingSnapshot.negotiatedRate.applied, true);
  });

  await check("inclusive GST preserves the agreed guest total", async () => {
    const settings = {
      ...noTaxSettings,
      gst_enabled: true,
      default_tax_mode: "inclusive"
    };
    const rules = [{
      id: 1,
      version: 1,
      rule_name: "18 percent inclusive",
      effective_from: "2026-01-01",
      minimum_taxable_value: 0,
      cgst_rate: 9,
      sgst_rate: 9,
      tax_inclusive: true
    }];
    const pricing = await resolveRoomBookingPricing({
      supabaseClient: pricingClient(settings, rules),
      hotelSlug: "demo-hotel",
      room: { id: 101, base_price: 1180 },
      checkInDate: "2026-08-01",
      checkOutDate: "2026-08-02",
      negotiatedRate: {
        nightlyRate: 944,
        reason: "Manager-approved inclusive rate",
        approvedBy: "owner-1",
        approverRole: "owner"
      }
    });
    assert.deepStrictEqual(
      [pricing.roomPrice, pricing.discountAmount, pricing.taxAmount, pricing.totalAmount],
      [1000, 200, 144, 944]
    );
  });

  await check("negotiated rate cannot increase the configured rate", async () => {
    await assert.rejects(resolveRoomBookingPricing({
      supabaseClient: pricingClient(noTaxSettings),
      hotelSlug: "demo-hotel",
      room: { id: 101, base_price: 1200 },
      checkInDate: "2026-08-01",
      checkOutDate: "2026-08-02",
      negotiatedRate: { nightlyRate: 1300, reason: "Invalid increase" }
    }), (error) => error.code === "ROOM_NEGOTIATED_RATE_ABOVE_CONFIGURED");
    await assert.rejects(resolveRoomBookingPricing({
      supabaseClient: pricingClient(noTaxSettings),
      hotelSlug: "demo-hotel",
      room: { id: 101, base_price: 1200 },
      checkInDate: "2026-08-01",
      checkOutDate: "2026-08-02",
      negotiatedRate: { nightlyRate: 1200, reason: "No actual discount" }
    }), (error) => error.code === "ROOM_NEGOTIATED_RATE_NO_DISCOUNT");
  });

  await check("authorization, UI and audit migration contracts are present", () => {
    const route = readBackend("routes/staff-room-booking.js");
    const html = readProject("frontend/staff-orders.html");
    const ui = readProject("frontend/js/staff-orders.js");
    const upgrade = readBackend("scripts/upgrade-room-negotiated-rate.sql");
    const rollback = readBackend("scripts/rollback-room-negotiated-rate.sql");
    [
      "ROOM_NEGOTIATED_RATE_MANAGER_REQUIRED",
      "ensureNegotiatedRateInfrastructure",
      "room_negotiated_rate_ready",
      "delete response.pricing_snapshot"
    ].forEach((token) => assert.ok(route.includes(token), "route missing " + token));
    assert.ok(html.includes("staffRoomNegotiatedRatePanel"));
    assert.ok(html.includes("data-staff-manager-only"));
    assert.ok(ui.includes("payload.negotiatedNightlyRate"));
    assert.ok(ui.includes("Negotiated-rate booking was not created"));
    assert.ok(upgrade.includes("trg_capture_room_negotiated_rate_approval"));
    assert.ok(upgrade.includes("room_negotiated_rate_approved"));
    assert.ok(upgrade.includes("enable row level security"));
    assert.ok(!/grant select, insert/i.test(upgrade), "approval table must not accept direct service-role inserts");
    assert.ok(!/drop table/i.test(rollback), "rollback must preserve approval evidence");
  });

  const passed = results.filter(Boolean).length;
  console.log("\nRoom negotiated-rate verification: " + passed + "/" + results.length + " passed.");
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Room negotiated-rate verification failed: " + error.message);
  process.exitCode = 1;
});
