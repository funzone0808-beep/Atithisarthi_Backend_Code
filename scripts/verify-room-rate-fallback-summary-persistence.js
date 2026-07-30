const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  getRoomDefaultNightlyPrice
} = require("../utils/room-pricing");

const projectRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

assert.deepStrictEqual(
  getRoomDefaultNightlyPrice({
    room: { discount_price: null, base_price: 3000 },
    roomType: { base_price: 3000 }
  }),
  { amount: 3000, source: "room_override" },
  "A NULL room discount must fall back to the room price."
);

assert.deepStrictEqual(
  getRoomDefaultNightlyPrice({
    room: { discount_price: "", base_price: null },
    roomType: { base_price: 1200 }
  }),
  { amount: 1200, source: "room_type_base" },
  "A blank discount and missing room price must fall back to the Room Type price."
);

assert.deepStrictEqual(
  getRoomDefaultNightlyPrice({
    room: { discount_price: 10, base_price: 1200 },
    roomType: { base_price: 1200 }
  }),
  { amount: 10, source: "room_discount_override" },
  "An explicit discounted nightly amount must remain an absolute amount."
);

const pricingSource = read("backend/utils/room-pricing.js");
assert.match(pricingSource, /ROOM_PRICE_NOT_CONFIGURED/);
assert.doesNotMatch(
  pricingSource,
  /const roomDiscount = Number\(room\?\.discount_price\)/,
  "Pricing must not coerce NULL discount_price to zero."
);

const publicSource = read("backend/routes/public-room-booking.js");
assert.match(
  publicSource,
  /getRoomDefaultNightlyPrice\(\{ room, roomType \}\)\.amount/,
  "Public room cards must use the shared rate fallback."
);

const staffSource = read("frontend/js/staff-orders.js");
assert.match(staffSource, /const cachedCheckoutMarkup = cachedCheckoutSummary && cachedCheckoutBill/);
assert.match(
  staffSource,
  /data-staff-room-checkout-summary="\$\{escapeHTML\(booking\.id \|\| ""\)\}" \$\{cachedCheckoutMarkup \? "" : "hidden"\}/,
  "Staff rerenders must restore a loaded checkout summary."
);

const adminSource = read("frontend/js/admin.js");
assert.match(adminSource, /const canReuseCachedCheckout =/);
assert.doesNotMatch(
  adminSource,
  /state\.roomBookings = bookingsResult\.bookings \|\| \[\];\s+state\.roomCheckoutSummaries = \{\};\s+state\.roomCheckoutBills = \{\};/,
  "Admin room refreshes must not erase loaded checkout summaries."
);
assert.match(
  adminSource,
  /\$\{cachedCheckoutMarkup \? "" : "hidden"\}\s+>\$\{cachedCheckoutMarkup\}<\/div>/,
  "Admin rerenders must restore a loaded checkout summary."
);

console.log("Room rate fallback and checkout-summary persistence verification passed.");
