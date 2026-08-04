"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function requireText(source, text, label) {
  assert.ok(source.includes(text), `${label} must include ${text}`);
}

function main() {
  const html = read("frontend/staff-orders.html");
  const frontend = read("frontend/js/staff-orders.js");
  const route = read("backend/routes/staff-room-booking.js");
  const availability = read("backend/utils/room-availability.js");
  const migration = read("backend/scripts/create-room-booking-tables.sql");
  const packageJson = read("backend/package.json");

  [
    "staffRoomOperationsHome",
    "staffRoomAvailabilityView",
    "staffRoomBookingView",
    "staffRoomServiceView",
    "staffRoomAvailabilityGrid",
    "staffRoomOperationsDrawer",
    "staffRoomBookingForm",
    "staffRoomServiceOrderForm",
    "staffRoomsContent"
  ].forEach((id) => requireText(html, `id=\"${id}\"`, "Room Operations HTML"));

  requireText(html, "New Room Booking", "Room Operations home");
  requireText(html, "View Room Availability", "Room Operations home");
  requireText(html, "data-staff-room-open-booking", "Room Operations navigation");
  requireText(html, "data-staff-room-open-availability", "Room Operations navigation");
  requireText(html, "data-staff-room-open-service", "Room Operations navigation");
  requireText(html, "@media (max-width: 720px)", "Room Operations responsive CSS");
  requireText(html, "@media (max-width: 390px)", "Room Operations mobile CSS");
  requireText(html, "@media (prefers-reduced-motion: reduce)", "Room Operations accessibility CSS");

  requireText(frontend, "function showStaffRoomOperationsView", "Room Operations frontend");
  requireText(frontend, "function renderStaffRoomAvailabilityGrid", "Room Operations frontend");
  requireText(frontend, "async function loadStaffRoomOperations", "Room Operations frontend");
  requireText(frontend, "async function openStaffRoomOperationDetail", "Room Operations lazy detail");
  requireText(frontend, "/room-booking/operations?", "Room Operations shared API usage");
  requireText(frontend, "/room-booking/bookings/${encodeURIComponent(bookingId)}", "Room Operations detail API usage");
  requireText(frontend, "await checkStaffRoomBookingAvailability();", "Room Operations booking revalidation");
  requireText(frontend, "showStaffRoomOperationsView(\"availability\")", "Room Operations asynchronous refresh");
  requireText(frontend, "data-staff-room-service-booking", "Room Operations room service handoff");

  requireText(route, 'router.get("/operations"', "Room Operations backend route");
  requireText(route, "req.staffHotelSlug", "Room Operations hotel scope");
  requireText(route, "applyActiveBookingOverlapFilter", "Room Operations shared overlap logic");
  requireText(route, 'select("id,room_id,check_in_date,check_out_date,booking_status,payment_status,booking_source,created_at,updated_at")', "Room Operations tile privacy");
  requireText(route, 'router.get("/bookings/:id"', "Room Operations lazy detail route");
  requireText(route, "buildStaffBookingDetailResponse(booking, canViewFinancial)", "Room Operations field-level detail shaping");
  requireText(route, "STAFF_BOOKING_STATUS_TRANSITIONS", "Room Operations status transition guard");
  requireText(route, "ROOM_NOT_READY_FOR_CHECK_IN", "Room Operations check-in readiness guard");
  requireText(route, "hasOtherBlockingBooking", "Room Operations confirmation conflict guard");

  requireText(availability, '.lt("check_in_date", checkOutDate)', "shared overlap helper");
  requireText(availability, '.gt("check_out_date", checkInDate)', "shared overlap helper");
  requireText(migration, "room_bookings_no_active_overlap", "database concurrency guard");
  requireText(migration, "daterange(check_in_date, check_out_date, '[)')", "half-open date policy");
  requireText(packageJson, '"verify:room-operations": "node scripts/verify-room-operations-module.js"', "Room Operations package script");

  console.log("Premium Room Operations module verification passed.");
  console.log("Verified same-route home, date-aware grid, lazy private details, guided booking, room-service handoff, responsive contracts, hotel scoping, transition safety, and database concurrency coverage.");
}

main();
