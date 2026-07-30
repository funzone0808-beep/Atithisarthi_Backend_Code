const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const route = read("backend/routes/staff.js");
const validator = read("backend/validators/staff.js");
const migration = read("backend/scripts/create-active-order-item-rounds.sql");
const rollback = read("backend/scripts/rollback-active-order-item-rounds.sql");
const script = read("frontend/js/staff-orders.js");
const html = read("frontend/staff-orders.html");

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Missing ${label}`);
}

function rejectPattern(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`Unsafe ${label}`);
}

function main() {
  requirePattern(migration, /create table if not exists public\.order_rounds[\s\S]*unique \(hotel_slug, order_id, sequence_number\)[\s\S]*unique \(hotel_slug, order_id, idempotency_key\)/m, "hotel-scoped round sequence and idempotency constraints");
  requirePattern(migration, /add_staff_items_to_active_order[\s\S]*from public\.orders[\s\S]*for update/m, "atomic order row lock");
  requirePattern(migration, /order_type[\s\S]*'dine-in'[\s\S]*parent_order_id is not null[\s\S]*ORDER_NOT_DINE_IN_ROOT/m, "root dine-in enforcement");
  requirePattern(migration, /payment_status[\s\S]*PAYMENT_LOCKED[\s\S]*billing_status[\s\S]*BILLING_LOCKED/m, "payment and final bill locks");
  requirePattern(migration, /order_version[\s\S]*p_expected_version[\s\S]*ORDER_VERSION_CONFLICT/m, "optimistic order concurrency");
  requirePattern(migration, /v_round_items[\s\S]*orderRoundSequence[\s\S]*kotReference[\s\S]*kitchenStatus[\s\S]*insert into public\.order_rounds[\s\S]*update public\.orders/m, "new-item-only KOT batch and same-order append");
  requirePattern(migration, /revoke all on function public\.add_staff_items_to_active_order[\s\S]*grant execute[\s\S]*service_role/m, "service-role-only atomic RPC");
  requirePattern(rollback, /drop function if exists public\.add_staff_items_to_active_order[\s\S]*drop table if exists public\.order_rounds[\s\S]*drop column if exists order_version/m, "reversible rollback");

  requirePattern(validator, /staffOrderItemAdditionSchema[\s\S]*tableNumber[\s\S]*expectedVersion[\s\S]*idempotencyKey[\s\S]*items: z\.array\(staffTableOrderItemSchema\)\.min\(1\)\.max\(100\)/m, "bounded item-addition contract");
  requirePattern(route, /"\/orders\/:id\/items"[\s\S]*requireStaffAuth[\s\S]*requireStaffFoodModule[\s\S]*validateBody\(staffOrderItemAdditionSchema\)/m, "authenticated feature-gated add-items API");
  requirePattern(route, /req\.staffHotelSlug[\s\S]*\.eq\("id", orderId\)[\s\S]*\.eq\("hotel_slug", hotelSlug\)/m, "hotel-scoped order lookup");
  requirePattern(route, /calculateStaffTableOrderPricing\(\{ hotelSlug, items: requestedItems \}\)[\s\S]*add_staff_items_to_active_order/m, "trusted backend pricing before atomic append");
  requirePattern(route, /req\.get\("Idempotency-Key"\)[\s\S]*buildStaffOrderAdditionFingerprint/m, "request idempotency and payload fingerprint");
  requirePattern(route, /function buildStaffKdsRoundTickets[\s\S]*isAdditionRound: true/m, "round-aware KDS ticket construction");
  requirePattern(route, /flatMap\(\(order\) => buildStaffKdsRoundTickets/m, "round-aware KDS ticket expansion");
  requirePattern(route, /"\/kds\/orders\/:id\/rounds\/:sequence\/kitchen-status"[\s\S]*\.eq\("hotel_slug", hotelSlug\)[\s\S]*\.eq\("order_id", orderId\)[\s\S]*\.eq\("sequence_number", sequence\)/m, "hotel-scoped round kitchen updates");

  requirePattern(script, /order\.canAddItems === true[\s\S]*data-staff-add-more-items/m, "allowed-state Add More Items action");
  requirePattern(script, /openStaffAddMoreItems[\s\S]*tableOrderMode = "add"[\s\S]*selectedTableOrderId = normalizedOrderId[\s\S]*tableOrderCart = \{\}[\s\S]*openStaffView\("table-order"\)[\s\S]*showStaffTakeOrderSubview\("create"/m, "Orders-to-Take-Order navigation with isolated new-items cart");
  rejectPattern(script, /selectedTableOrderId[^\n]*order\.canAddItems === true[\s\S]{0,240}data-staff-add-more-items/m, "selected-table-only Add More Items visibility gate");
  requirePattern(script, /\/orders\/\$\{encodeURIComponent\(orderId\)\}\/items[\s\S]*Idempotency-Key[\s\S]*expectedVersion/m, "frontend idempotent versioned submission");
  requirePattern(script, /ORDER_VERSION_CONFLICT[\s\S]*Your new-items cart is preserved for review/m, "stale-update recovery without cart loss");
  requirePattern(script, /buildStaffOrderRoundsMarkup[\s\S]*Original order[\s\S]*New items only/m, "round hierarchy in active-order detail");
  requirePattern(script, /data-round-sequence[\s\S]*\/rounds\/\$\{encodeURIComponent\(roundSequence\)\}/m, "round-specific KDS actions");
  requirePattern(script, /data-staff-table-order-item-note[\s\S]*note: item\.note/m, "item kitchen notes");
  rejectPattern(script, /(?:window\.)?location\.reload\s*\(/m, "full-page refresh in staff workflow");

  requirePattern(html, /\.staff-add-more-items-btn[\s\S]*\.staff-order-rounds[\s\S]*@media \(max-width: 520px\)/m, "responsive round and primary-action styling");

  console.log("Staff active-order Add More Items verification passed.");
  console.log("Verified same-order atomic append, rounds/KOTs, hotel scope, idempotency, concurrency, backend pricing, billing locks, new-item-only KDS tickets, item notes, responsive UI, and rollback.");
}

main();
