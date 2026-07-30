"use strict";

function getRoomIdempotencyKey(req = {}) {
  const raw = String(req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"] || "").trim();
  if (!raw) return { key: null, error: null };
  if (raw.length < 8 || raw.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) {
    return { key: null, error: "Idempotency-Key must be 8 to 200 safe characters" };
  }
  return { key: raw, error: null };
}

async function findRoomBookingByIdempotency({ supabaseClient, hotelSlug, key }) {
  if (!key) return null;
  const { data, error } = await supabaseClient.from("room_bookings").select("*")
    .eq("hotel_slug", hotelSlug).eq("idempotency_key", key).maybeSingle();
  if (error) {
    const code = String(error.code || "").toUpperCase();
    const details = `${error.message || ""} ${error.details || ""}`.toLowerCase();
    if (["42703", "PGRST204"].includes(code) && details.includes("idempotency_key")) return null;
    throw error;
  }
  return data || null;
}

function isRoomIdempotencyConflict(error) {
  const code = String(error?.code || "").toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return code === "23505" && (details.includes("room_bookings_scope_idempotency_unique") || details.includes("idempotency_key"));
}

module.exports = { findRoomBookingByIdempotency, getRoomIdempotencyKey, isRoomIdempotencyConflict };
