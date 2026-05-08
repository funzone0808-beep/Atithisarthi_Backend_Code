const express = require("express");
const { supabase } = require("../utils/supabase");
const { publicInquiryLimiter } = require("../middleware/public-rate-limiters");
const { createNotificationEventSafely } = require("../utils/notifications");
const { ensurePublicHotelAccess } = require("../utils/public-hotel-access");

// ✅ Added imports
const { validateBody } = require("../validators/common");
const { inquirySchema } = require("../validators/public");

const router = express.Router();

// ✅ Middleware added
router.post("/", publicInquiryLimiter, validateBody(inquirySchema), async (req, res) => {
  try {
    // ✅ Use validatedBody
    const {
      hotelName,
      hotelSlug,
      name,
      phone,
      eventType,
      date,
      guests,
      specialRequirements
    } = req.validatedBody;

    const hotelAccess = await ensurePublicHotelAccess(req, res, hotelSlug, {
      notFoundMessage: "Hotel is not available for inquiries",
      forbiddenMessage: "This hotel cannot accept inquiries from the current origin"
    });

    if (!hotelAccess) {
      return;
    }

    // (Optional: manual validation can be removed since schema handles it)

    const { data, error } = await supabase
      .from("inquiries")
      .insert([
        {
          hotel_name: hotelName || "Unknown Hotel",
          hotel_slug: hotelSlug || null,
          name,
          phone,
          event_type: eventType,
          date,
          guests: guests || "",
          special_requirements: specialRequirements || "",
          status: "new"
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    void createNotificationEventSafely({
      hotelSlug: data.hotel_slug || hotelSlug || null,
      sourceType: "inquiry",
      sourceId: data.id,
      payload: {
        inquiryId: data.id,
        hotelName: data.hotel_name || hotelName || "",
        name: data.name || name,
        phone: data.phone || phone,
        eventType: data.event_type || eventType || "",
        date: data.date || date,
        guests: data.guests || guests || "",
        specialRequirements:
          data.special_requirements || specialRequirements || "",
        status: data.status || "new"
      }
    });

    res.status(201).json({
      success: true,
      message: "Inquiry saved successfully",
      inquiry: data
    });
  } catch (error) {
    console.error("Inquiry save error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save inquiry"
    });
  }
});

module.exports = router;
