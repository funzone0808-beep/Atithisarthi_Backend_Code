"use strict";

const { requireAdminAuth } = require("../middleware/require-admin-auth");
const { supabase } = require("../utils/supabase");
const { createRoomCheckoutBillRouter } = require("./create-room-checkout-bill-router");

async function resolveAdminBookingHotelSlug(req) {
  const bookingId = String(req.params?.id || "").trim();
  if (!bookingId) return "";
  const { data, error } = await supabase
    .from("room_bookings")
    .select("hotel_slug")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  return data?.hotel_slug || "";
}

module.exports = createRoomCheckoutBillRouter({
  supabaseClient: supabase,
  authMiddleware: requireAdminAuth,
  resolveHotelSlug: (req) =>
    String(req.query?.hotelSlug || req.body?.hotelSlug || "").trim(),
  resolveBookingHotelSlug: resolveAdminBookingHotelSlug,
  resolveActor: (req) => ({
    id: req.adminUser?.sub || req.adminUser?.id || null,
    role: "platform_admin",
    displayName: req.adminUser?.fullName || "Platform admin"
  })
});
