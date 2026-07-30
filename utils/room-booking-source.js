"use strict";

const ROOM_BOOKING_SOURCE_GROUPS = Object.freeze({
  website: Object.freeze(["online", "website", "web", "public_site"]),
  manual: Object.freeze(["staff", "admin", "walk-in", "phone", "whatsapp"])
});

const ROOM_BOOKING_SOURCE_LABELS = Object.freeze({
  online: "Website",
  website: "Website",
  web: "Website",
  public_site: "Website",
  staff: "Staff",
  admin: "Manager",
  "walk-in": "Walk-In",
  phone: "Phone",
  whatsapp: "WhatsApp"
});

function normalizeRoomBookingSourceValue(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function getRoomBookingSourceGroup(value = "") {
  const source = normalizeRoomBookingSourceValue(value);
  if (ROOM_BOOKING_SOURCE_GROUPS.website.includes(source)) return "website";
  if (ROOM_BOOKING_SOURCE_GROUPS.manual.includes(source)) return "manual";
  return "legacy";
}

function getRoomBookingSourceLabel(value = "") {
  const source = normalizeRoomBookingSourceValue(value);
  return ROOM_BOOKING_SOURCE_LABELS[source] || (source ? "Legacy / Other" : "Legacy / Unknown");
}

function getRoomBookingSourceFilterValues(group = "") {
  const normalizedGroup = normalizeRoomBookingSourceValue(group);
  if (ROOM_BOOKING_SOURCE_GROUPS[normalizedGroup]) {
    return [...ROOM_BOOKING_SOURCE_GROUPS[normalizedGroup]];
  }

  const knownRawSources = Object.values(ROOM_BOOKING_SOURCE_GROUPS).flat();
  return knownRawSources.includes(normalizedGroup) ? [normalizedGroup] : [];
}

function buildRoomBookingSourceSummary(rows = []) {
  const empty = () => ({ total: 0, pending: 0, today: 0 });
  const summary = { website: empty(), manual: empty(), legacy: empty() };
  const today = new Date().toISOString().slice(0, 10);

  for (const row of Array.isArray(rows) ? rows : []) {
    const group = getRoomBookingSourceGroup(row.booking_source);
    const target = summary[group];
    target.total += 1;
    if (normalizeRoomBookingSourceValue(row.booking_status) === "pending") {
      target.pending += 1;
    }
    if (String(row.created_at || "").slice(0, 10) === today) {
      target.today += 1;
    }
  }

  return summary;
}

module.exports = {
  ROOM_BOOKING_SOURCE_GROUPS,
  ROOM_BOOKING_SOURCE_LABELS,
  buildRoomBookingSourceSummary,
  getRoomBookingSourceFilterValues,
  getRoomBookingSourceGroup,
  getRoomBookingSourceLabel,
  normalizeRoomBookingSourceValue
};
