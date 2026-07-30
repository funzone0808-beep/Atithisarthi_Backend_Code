"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

function main() {
  const runbookPath = path.join(
    __dirname,
    "room-combined-checkout-staging-runbook.md"
  );
  const packagePath = path.join(__dirname, "..", "package.json");
  const productionRunbookPath = path.join(
    __dirname,
    "production-launch-smoke-test-runbook.md"
  );
  const runbook = fs.readFileSync(runbookPath, "utf8");
  const productionRunbook = fs.readFileSync(productionRunbookPath, "utf8");
  const packageJson = fs.readFileSync(packagePath, "utf8");

  assert.match(runbook, /staging-only/i);
  assert.match(runbook, /Do not apply `create-room-combined-checkout\.sql` to production/i);
  assert.match(runbook, /npm run verify:room-checkout-preflight/);
  assert.match(runbook, /npm run verify:room-checkout-migration/);
  assert.match(runbook, /npm run verify:room-checkout-readiness/);
  assert.match(runbook, /ROOM_COMBINED_CHECKOUT_ENABLED=false/);
  assert.match(runbook, /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=false/);
  assert.match(runbook, /ROOM_CHECKOUT_STAGING_VERIFY="I_UNDERSTAND_STAGING_ONLY"/);
  assert.match(runbook, /npm run verify:room-checkout-staging/);
  assert.match(runbook, /Do not enable the application or frontend feature flags yet\./);
  assert.match(runbook, /ROOM_COMBINED_CHECKOUT_ENABLED=true/);
  assert.match(runbook, /ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=true/);
  assert.match(runbook, /explicit confirmation before posting settlement/);
  assert.match(runbook, /Click `Finalize Combined Checkout` once from admin or manager staff/);
  assert.match(runbook, /Staging flags are returned to `false` after the checkout smoke test/);
  assert.match(runbook, /food ordering, QR ordering, KDS, billing, admin login, staff login, or tenant isolation/);

  assert.match(productionRunbook, /Room combined checkout production gate/);
  assert.match(
    productionRunbook,
    /Keep `ROOM_COMBINED_CHECKOUT_ENABLED=false` and `ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=false` for production unless the staging-only combined checkout runbook has passed and production enablement is separately approved\./
  );
  assert.match(productionRunbook, /npm\.cmd run verify:room-checkout-runbook/);
  assert.match(productionRunbook, /npm\.cmd run verify:room-checkout-production-flags/);
  assert.match(productionRunbook, /room-combined-checkout-staging-runbook\.md/);
  assert.match(productionRunbook, /ROOM_CHECKOUT_STAGING_VERIFY="I_UNDERSTAND_STAGING_ONLY"/);
  assert.match(productionRunbook, /Do not enable production combined checkout from this launch checklist alone\./);
  assert.match(
    productionRunbook,
    /Room combined checkout backend and frontend flags remain disabled unless the staging-only runbook has passed and production enablement is explicitly approved\./
  );
  assert.match(
    productionRunbook,
    /The frontend-only production flag combination is blocked before any operator can see enabled combined checkout controls\./
  );
  assert.match(
    packageJson,
    /"verify:room-checkout-runbook":\s*"node scripts\/verify-room-combined-checkout-runbook\.js"/
  );
  assert.match(
    packageJson,
    /"verify:room-checkout-production-flags":\s*"node scripts\/verify-room-combined-checkout-production-flags\.js"/
  );

  console.log("Combined checkout runbook verification passed.");
  console.log("Verified staging-only rollout guidance, confirmed UI checkout, flag rollback, production launch gate, and production-disabled guardrails.");
}

main();