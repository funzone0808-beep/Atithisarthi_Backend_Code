"use strict";

const ACTIVE_BLOCKING_BOOKING_STATUSES = ["pending", "confirmed", "checked_in"];
const ROOM_STATUSES_BLOCKING_BOOKING = ["maintenance", "inactive"];
const ROOM_BOOKING_CONFLICT_CODE = "ROOM_ALREADY_BOOKED";
const ROOM_BOOKING_CONFLICT_MESSAGE =
  "This room is already booked for selected dates. Please choose another room or date.";

function applyActiveBookingOverlapFilter(query, { checkInDate, checkOutDate } = {}) {
  return query
    .in("booking_status", ACTIVE_BLOCKING_BOOKING_STATUSES)
    .lt("check_in_date", checkOutDate)
    .gt("check_out_date", checkInDate);
}

function isRoomBookingOverlapError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "23P01" ||
    details.includes("room_bookings_no_active_overlap") ||
    details.includes("conflicting key value violates exclusion constraint")
  );
}

function isMissingMaintenanceSchemaError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) &&
    details.includes("room_maintenance");
}

async function fetchMaintenanceBlockedRoomIds({
  supabaseClient,
  hotelSlug,
  roomIds = [],
  checkInDate,
  checkOutDate
}) {
  if (!supabaseClient || !hotelSlug || !roomIds.length || !checkInDate || !checkOutDate) {
    return new Set();
  }

  const startAt = `${checkInDate}T00:00:00.000Z`;
  const endAt = `${checkOutDate}T00:00:00.000Z`;
  const { data, error } = await supabaseClient
    .from("room_maintenance")
    .select("room_id")
    .eq("hotel_slug", hotelSlug)
    .in("room_id", roomIds)
    .in("status", ["open", "in_progress"])
    .lt("start_at", endAt)
    .or(`end_at.is.null,end_at.gt.${startAt}`);

  // The foundation migration remains backward-compatible before the optional
  // professional operations migration is applied.
  if (error && isMissingMaintenanceSchemaError(error)) return new Set();
  if (error) throw error;
  return new Set((data || []).map((record) => String(record.room_id)));
}

module.exports = {
  ACTIVE_BLOCKING_BOOKING_STATUSES,
  ROOM_STATUSES_BLOCKING_BOOKING,
  ROOM_BOOKING_CONFLICT_CODE,
  ROOM_BOOKING_CONFLICT_MESSAGE,
  applyActiveBookingOverlapFilter,
  fetchMaintenanceBlockedRoomIds,
  isRoomBookingOverlapError
};
