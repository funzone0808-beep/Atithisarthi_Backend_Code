"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const fixturePath = path.resolve(__dirname, "..", "..", "tests", "fixtures", "golden-pricing.json");
const document = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
assert.strictEqual(document.schemaVersion, 1);
assert.ok(Array.isArray(document.fixtures) && document.fixtures.length >= 8);
assert.strictEqual(new Set(document.fixtures.map((fixture) => fixture.id)).size, document.fixtures.length);
for (const fixture of document.fixtures) {
  assert.ok(fixture.id && fixture.name && fixture.scope && fixture.status, `Incomplete fixture ${fixture.id || "unknown"}`);
}
const basic = document.fixtures.find((fixture) => fixture.id === "GP-001");
assert.strictEqual(basic.currentResult.total, 250);
const quantity = document.fixtures.find((fixture) => fixture.id === "GP-002");
assert.strictEqual(quantity.currentResult.total, quantity.input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
const combined = document.fixtures.find((fixture) => fixture.id === "GP-006");
assert.strictEqual(combined.currentResult.amount, combined.input.roomBalance + combined.input.foodOutstanding);
const refund = document.fixtures.find((fixture) => fixture.id === "GP-007");
assert.strictEqual(refund.currentResult.netPaid, refund.input.paid - refund.input.refund);
console.log(`Golden pricing fixture verification passed: ${document.fixtures.length} fixtures structurally valid.`);
console.log("Fixtures marked NOT_RUNTIME_VERIFIED remain documentary baselines until staging is available.");
