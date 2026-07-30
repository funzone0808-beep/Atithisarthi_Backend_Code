"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assertIncludes(source, text, label) {
  assert.ok(source.includes(text), `${label} must include ${text}`);
}

function main() {
  const audit = read("backend/scripts/room-booking-production-gap-audit.md");
  const packageJson = read("backend/package.json");
  const doubleBookingVerifier = read("backend/scripts/verify-room-double-booking-safety.js");
  const permissionVerifier = read("backend/scripts/verify-room-booking-action-permissions.js");

  assertIncludes(audit, "Status: freeze the safety baseline, not the full product promise.", "gap audit");
  assertIncludes(audit, "## Freeze-ready now", "gap audit");
  assertIncludes(audit, "## Partial, not final-freeze", "gap audit");
  assertIncludes(audit, "## Remaining before full production claim", "gap audit");
  assertIncludes(audit, "Freeze label: `Room Booking Safety + Permissions Baseline`.", "gap audit");
  assertIncludes(audit, "Do not label the entire original prompt as complete yet.", "gap audit");
  assertIncludes(audit, "ROOM_ALREADY_BOOKED", "gap audit");
  assertIncludes(audit, "manager_access_required", "gap audit");
  assertIncludes(audit, "Apply `create-room-booking-tables.sql`", "gap audit");
  assertIncludes(audit, "Smoke test old flows", "gap audit");
  assertIncludes(audit, "tenant isolation", "gap audit");
  assertIncludes(audit, "room online payment", "gap audit");
  assertIncludes(audit, "dedicated room reports", "gap audit");

  assertIncludes(doubleBookingVerifier, "Room double-booking safety verification passed.", "double booking verifier");
  assertIncludes(permissionVerifier, "Room booking action permission verification passed.", "permission verifier");
  assert.match(
    packageJson,
    /"verify:room-booking-gap-audit":\s*"node scripts\/verify-room-booking-production-gap-audit\.js"/,
    "package.json must expose the room booking gap audit verifier"
  );

  console.log("Room booking production gap audit verification passed.");
  console.log("Verified the freeze label, completed baseline, partial items, and remaining production-launch work are documented.");
}

main();