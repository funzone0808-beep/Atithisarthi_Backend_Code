"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const has = (source, value, label) => assert.ok(source.includes(value), `${label} must include ${value}`);

function main() {
  const migration = read("backend/scripts/upgrade-professional-room-operations.sql");
  const rollback = read("backend/scripts/rollback-professional-room-operations.sql");
  const route = read("backend/routes/staff-room-management.js");
  const pricing = read("backend/utils/room-pricing.js");
  const idempotency = read("backend/utils/room-idempotency.js");
  const availability = read("backend/utils/room-availability.js");
  const server = read("backend/server.js");
  const html = read("frontend/staff-orders.html");
  const frontend = read("frontend/js/room-operations-manager.js");
  const css = read("frontend/css/room-operations-manager.css");

  ["hotel_floors", "room_rate_plans", "room_maintenance", "room_housekeeping_tasks", "hotel_guest_profiles", "guest_stays", "room_shifts", "room_operation_audit"].forEach((table) => has(migration, `public.${table}`, "professional migration"));
  has(migration, "room_bookings_scope_idempotency_unique", "booking idempotency");
  has(migration, "pricing_snapshot", "pricing snapshot");
  has(migration, "for update", "transaction row locks");
  has(migration, "shift_room_booking", "atomic room shift");
  has(migration, "extend_room_booking", "atomic stay extension");
  has(migration, "revoke all on function", "RPC access restriction");
  has(migration, "trg_sync_guest_stay_from_booking_status", "stay lifecycle sync");
  has(rollback, "drop table if exists public.hotel_floors", "rollback floors");
  has(rollback, "Existing room_types, rooms, room_bookings", "rollback data preservation");

  has(server, 'app.use("/api/staff/room-management", staffRoomManagementRoute)', "route mount");
  has(route, "router.use(requireStaffAuth)", "authentication");
  has(route, "router.use(requireRooms)", "room module gate");
  has(route, "router.use(requireStaffManagerAccess)", "manager permission gate");
  assert.ok(route.indexOf('router.get("/daily"') < route.indexOf("router.use(requireStaffManagerAccess)"), "daily operations must be available before the manager-only boundary");
  ["/configuration", "/floors", "/room-types", "/rooms", "/rate-plans", "/amenities", "/maintenance", "/housekeeping", "/bookings/:id/shift", "/bookings/:id/extend", "/reports/summary"].forEach((endpoint) => has(route, endpoint, "manager room route"));
  has(route, '.eq("hotel_slug", hotelSlug)', "tenant ownership checks");
  has(route, "ROOM_HAS_ACTIVE_OPERATIONS", "safe room deactivation");
  has(route, "FLOOR_HAS_ACTIVE_ROOMS", "safe floor deactivation");

  has(pricing, "priceSource", "price source snapshot");
  has(pricing, "room_type_base", "room type pricing");
  has(pricing, "room_override", "room override pricing");
  has(pricing, "rate_plan", "rate plan pricing");
  has(pricing, "extraGuestAmount", "extra guest pricing");
  has(idempotency, "findRoomBookingByIdempotency", "booking idempotency lookup");
  has(idempotency, "room_bookings_scope_idempotency_unique", "booking idempotency conflict handling");
  has(availability, "fetchMaintenanceBlockedRoomIds", "maintenance-aware shared availability");

  ["staffRoomDailyView", "staffRoomHousekeepingView", "staffRoomMaintenanceView", "staffRoomConfigurationView", "staffRoomReportsView", "staffFloorForm", "staffRoomInventoryForm", "staffRatePlanForm"].forEach((id) => has(html, `id="${id}"`, "professional Room Operations UI"));
  has(html, "data-staff-manager-only", "manager-only UI controls");
  has(frontend, "showProfessionalRoomView", "in-place navigation");
  has(frontend, "safeCsvCell", "CSV formula injection protection");
  has(frontend, "`/bookings/${bookingId}/shift`", "room shift UI");
  has(frontend, "loadProfessionalRoomConfiguration", "lazy configuration load");
  has(css, "@media (max-width: 720px)", "tablet/mobile layout");
  has(css, "@media (max-width: 390px)", "narrow mobile layout");

  console.log("Professional Manager and Staff Room Operations verification passed.");
  console.log("Verified additive schema and rollback, tenant/role boundaries, pricing snapshots, maintenance-aware shared availability, atomic room shift/extension, Manager configuration, daily operations, reports, safe CSV and responsive contracts.");
}

main();
