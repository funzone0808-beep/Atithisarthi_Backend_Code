const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "frontend", "js", "staff-orders.js"),
  "utf8"
);

[
  "[data-staff-room-payment-amount]",
  "[data-staff-room-payment-method]",
  "[data-staff-room-payment-transaction]",
  "[data-staff-room-payment-notes]",
  "[data-staff-room-refund-amount]",
  "[data-staff-room-refund-method]",
  "[data-staff-room-refund-transaction]",
  "[data-staff-room-refund-reason]"
].forEach((selector) => {
  assert.ok(
    source.includes(`"${selector}"`),
    `Room auto-refresh draft tracking must include ${selector}.`
  );
});

assert.match(source, /function captureStaffRoomBookingDrafts\(\)/);
assert.match(source, /function restoreStaffRoomBookingDrafts\(drafts = \[\]\)/);
assert.match(
  source,
  /const roomBookingDrafts = silent \? captureStaffRoomBookingDrafts\(\) : \[\];\s+renderCurrentStaffRooms\(\);\s+if \(silent\) \{\s+restoreStaffRoomBookingDrafts\(roomBookingDrafts\);/,
  "Silent Room refreshes must restore editable drafts after rendering."
);
assert.match(
  source,
  /if \(silent && isStaffActionInProgress\(\)\) \{[\s\S]*?return;\s+\}\s+const roomBookingDrafts/,
  "A Room rerender must be deferred while a payment, refund, or summary action is running."
);

[
  "data-staff-room-refund-amount",
  "data-staff-room-refund-method",
  "data-staff-room-refund-transaction",
  "data-staff-room-refund-reason"
].forEach((attribute) => {
  const fragment = source.match(
    new RegExp(`${attribute}[\\s\\S]{0,140}?data-booking-id="\\$\\{escapeHTML\\(bookingId\\)\\}"`)
  );
  assert.ok(fragment, `${attribute} must carry a stable booking id.`);
});

assert.ok(
  (source.match(/document\.querySelectorAll\("\[data-staff-room-checkout-summary\]"\)/g) || [])
    .length >= 2,
  "Checkout Summary success and error paths must re-query the current rendered target."
);

console.log("Staff Room draft-safe auto-refresh verification passed.");
