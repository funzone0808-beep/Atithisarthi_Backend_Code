const express = require("express");
const { supabase } = require("../utils/supabase");
const { requireAdminAuth } = require("../middleware/require-admin-auth");
const {
  processNotificationEventDeliverySafely
} = require("../utils/notifications");
const router = express.Router();
const { validateBody } = require("../validators/common");
const {
  galleryItemSchema,
  hotelSchema,
  hotelPaymentRouteSettingsSchema,
  hotelNotificationSettingsSchema,
  menuItemSchema,
  partialGalleryItemSchema,
  hotelProfileSchema,
  testimonialSchema,
  partialTestimonialSchema
} = require("../validators/admin");

const NOTIFICATION_EVENT_SOURCE_TYPES = ["order", "reservation", "inquiry"];
const NOTIFICATION_EVENT_STATUSES = ["pending", "sent", "failed", "skipped"];
const NOTIFICATION_EVENT_MAX_RETRIES = 3;
const ORDER_STATUSES = ["new", "confirmed", "preparing", "completed", "cancelled"];
const RESERVATION_STATUSES = ["new", "confirmed", "seated", "completed", "cancelled"];
const INQUIRY_STATUSES = ["new", "contacted", "converted", "closed"];
const CONTACT_SUBMISSION_STATUSES = ["new", "contacted", "resolved", "closed", "archived"];
const ORDER_BILLING_STATUSES = ["not_billed", "billed", "cancelled"];
const ORDER_PAYMENT_STATUSES = ["unpaid", "customer_confirmed", "paid", "refunded"];

function isMissingTestimonialsRelationError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (details.includes("testimonial") &&
      (details.includes("relation") ||
        details.includes("schema cache") ||
        details.includes("could not find")))
  );
}

function isMissingContactSubmissionsRelationError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (details.includes("contact_submissions") &&
      (details.includes("relation") ||
        details.includes("schema cache") ||
        details.includes("could not find")))
  );
}

function getNotificationEventsLimit(value) {
  const parsedValue = Number.parseInt(String(value || "").trim(), 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 100;
  }

  return Math.min(parsedValue, 200);
}

function normalizeStatusValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getAllowedStatus(value, allowedStatuses = []) {
  const normalizedStatus = normalizeStatusValue(value);
  return allowedStatuses.includes(normalizedStatus) ? normalizedStatus : "";
}

function normalizeBillNumberPart(value, fallback = "ORDER", maxLength = 18) {
  const normalizedValue = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (normalizedValue || fallback).slice(0, maxLength);
}

function buildOrderBillNumber(order = {}, billedAt = new Date().toISOString()) {
  const hotelPart = normalizeBillNumberPart(
    order.hotel_slug || order.hotel_name,
    "HOTEL",
    18
  );
  const datePart = String(billedAt || new Date().toISOString())
    .slice(0, 10)
    .replace(/[^0-9]/g, "");
  const orderIdPart = String(order.id || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(-8);

  return [
    "BILL",
    hotelPart,
    datePart || "DATE",
    orderIdPart || "ORDER"
  ].join("-");
}

function buildOrderBillingUpdatePayload(body = {}) {
  const updatePayload = {};
  const updatedAt = new Date().toISOString();

  if (body.billingStatus !== undefined) {
    const billingStatus = normalizeStatusValue(body.billingStatus);

    if (!ORDER_BILLING_STATUSES.includes(billingStatus)) {
      return {
        error: `Billing status must be one of: ${ORDER_BILLING_STATUSES.join(", ")}`
      };
    }

    updatePayload.billing_status = billingStatus;

    if (billingStatus === "billed") {
      updatePayload.billed_at = updatedAt;
    } else if (billingStatus === "not_billed") {
      updatePayload.billed_at = null;
    }
  }

  if (body.paymentStatus !== undefined) {
    const paymentStatus = normalizeStatusValue(body.paymentStatus);

    if (!ORDER_PAYMENT_STATUSES.includes(paymentStatus)) {
      return {
        error: `Payment status must be one of: ${ORDER_PAYMENT_STATUSES.join(", ")}`
      };
    }

    updatePayload.payment_status = paymentStatus;

    if (paymentStatus === "paid") {
      updatePayload.paid_at = updatedAt;
    } else if (paymentStatus === "unpaid") {
      updatePayload.paid_at = null;
    }
  }

  if (!Object.keys(updatePayload).length) {
    return {
      error: "Billing status or payment status is required"
    };
  }

  return { updatePayload };
}

function isMissingOrderBillingColumnsError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();
  const billingColumns = [
    "payment_status",
    "billing_status",
    "bill_number",
    "billed_at",
    "paid_at"
  ];

  return (
    code === "PGRST204" ||
    (
      details.includes("could not find") &&
      billingColumns.some((columnName) => details.includes(columnName))
    )
  );
}

function buildNotificationSettingsResponse(settingsRow, hotelSlug = "") {
  return {
    hotelSlug: settingsRow?.hotel_slug || String(hotelSlug || "").trim(),
    emailEnabled: !!settingsRow?.email_enabled,
    ownerEmail: settingsRow?.owner_email || "",
    notifyOnNewOrder:
      settingsRow?.notify_on_new_order !== undefined
        ? !!settingsRow.notify_on_new_order
        : true,
    notifyOnNewReservation:
      settingsRow?.notify_on_new_reservation !== undefined
        ? !!settingsRow.notify_on_new_reservation
        : true,
    notifyOnNewInquiry:
      settingsRow?.notify_on_new_inquiry !== undefined
        ? !!settingsRow.notify_on_new_inquiry
      : true
  };
}

function isMissingPaymentRouteSettingsTableError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    details.includes("hotel_payment_route_settings")
  );
}

function buildPaymentRouteSettingsResponse(settingsRow, hotelSlug = "") {
  return {
    hotelSlug: settingsRow?.hotel_slug || String(hotelSlug || "").trim(),
    provider: settingsRow?.provider || "razorpay",
    routeEnabled: !!settingsRow?.route_enabled,
    razorpayLinkedAccountId: settingsRow?.razorpay_linked_account_id || ""
  };
}

router.use(requireAdminAuth);
/* ─────────────────────────────────────────────
   GET /api/admin/orders
   Optional query: ?hotelName=Hotel Example
   ───────────────────────────────────────────── */
router.get("/orders", async (req, res) => {
  try {
    const { hotelName } = req.query;

    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (hotelName) {
      query = query.eq("hotel_name", hotelName);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      orders: data
    });
  } catch (error) {
    console.error("Admin orders fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders"
    });
  }
});

/* ─────────────────────────────────────────────
   GET /api/admin/inquiries
   Optional query: ?hotelName=Hotel Example
   ───────────────────────────────────────────── */
router.get("/inquiries", async (req, res) => {
  try {
    const { hotelName } = req.query;

    let query = supabase
      .from("inquiries")
      .select("*")
      .order("created_at", { ascending: false });

    if (hotelName) {
      query = query.eq("hotel_name", hotelName);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      inquiries: data
    });
  } catch (error) {
    console.error("Admin inquiries fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch inquiries"
    });
  }
});

/* ─────────────────────────────────────────────
   GET /api/admin/reservations
   Optional query: ?hotelName=Hotel Example
   ───────────────────────────────────────────── */
router.get("/reservations", async (req, res) => {
  try {
    const { hotelName } = req.query;

    let query = supabase
      .from("reservations")
      .select("*")
      .order("created_at", { ascending: false });

    if (hotelName) {
      query = query.eq("hotel_name", hotelName);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      reservations: data
    });
  } catch (error) {
    console.error("Admin reservations fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reservations"
    });
  }
});

router.get("/contact-submissions", async (req, res) => {
  try {
    const { hotelName, hotelSlug } = req.query;

    let query = supabase
      .from("contact_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (hotelSlug) {
      query = query.eq("hotel_slug", String(hotelSlug).trim());
    } else if (hotelName) {
      query = query.eq("hotel_name", String(hotelName).trim());
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingContactSubmissionsRelationError(error)) {
        return res.json({
          success: true,
          count: 0,
          contactSubmissions: []
        });
      }

      throw error;
    }

    res.json({
      success: true,
      count: Array.isArray(data) ? data.length : 0,
      contactSubmissions: data || []
    });
  } catch (error) {
    console.error("Admin contact submissions fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch contact submissions"
    });
  }
});

router.get("/notification-events", async (req, res) => {
  try {
    const { hotelSlug, sourceType, status } = req.query;
    const limit = getNotificationEventsLimit(req.query.limit);

    let query = supabase
      .from("notification_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (hotelSlug) {
      query = query.eq("hotel_slug", String(hotelSlug).trim());
    }

    if (
      sourceType &&
      NOTIFICATION_EVENT_SOURCE_TYPES.includes(
        String(sourceType).trim().toLowerCase()
      )
    ) {
      query = query.eq("source_type", String(sourceType).trim().toLowerCase());
    }

    if (
      status &&
      NOTIFICATION_EVENT_STATUSES.includes(String(status).trim().toLowerCase())
    ) {
      query = query.eq("status", String(status).trim().toLowerCase());
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      notificationEvents: data,
      notificationEventMaxRetries: NOTIFICATION_EVENT_MAX_RETRIES
    });
  } catch (error) {
    console.error("Notification events fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification events"
    });
  }
});

router.post("/notification-events/:id/resend", async (req, res) => {
  try {
    const notificationEventId = String(req.params.id || "").trim();

    if (!notificationEventId) {
      return res.status(400).json({
        success: false,
        message: "Notification event id is required"
      });
    }

    const { data: notificationEvent, error } = await supabase
      .from("notification_events")
      .select("*")
      .eq("id", notificationEventId)
      .maybeSingle();

    if (error) throw error;

    if (!notificationEvent) {
      return res.status(404).json({
        success: false,
        message: "Notification event not found"
      });
    }

    const currentStatus = String(notificationEvent.status || "")
      .trim()
      .toLowerCase();

    if (!["failed", "skipped"].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Only failed or skipped notification events can be resent"
      });
    }

    const currentRetryCount = Number.parseInt(
      String(notificationEvent.retry_count ?? "0"),
      10
    );
    const safeRetryCount =
      Number.isFinite(currentRetryCount) && currentRetryCount >= 0
        ? currentRetryCount
        : 0;

    if (safeRetryCount >= NOTIFICATION_EVENT_MAX_RETRIES) {
      return res.status(400).json({
        success: false,
        message: `Maximum resend attempts reached (${NOTIFICATION_EVENT_MAX_RETRIES})`
      });
    }

    const nextRetryCount = safeRetryCount + 1;
    const lastRetryAt = new Date().toISOString();

    const { error: prepareRetryError } = await supabase
      .from("notification_events")
      .update({
        status: "pending",
        error_message: null,
        processed_at: null,
        retry_count: nextRetryCount,
        last_retry_at: lastRetryAt,
        updated_at: lastRetryAt
      })
      .eq("id", notificationEventId);

    if (prepareRetryError) throw prepareRetryError;

    const processedEvent = await processNotificationEventDeliverySafely({
      ...notificationEvent,
      status: "pending",
      error_message: null,
      processed_at: null,
      retry_count: nextRetryCount,
      last_retry_at: lastRetryAt
    });

    if (processedEvent) {
      return res.json({
        success: true,
        message: `Notification resend processed (attempt ${nextRetryCount}/${NOTIFICATION_EVENT_MAX_RETRIES})`,
        notificationEventMaxRetries: NOTIFICATION_EVENT_MAX_RETRIES,
        notificationEvent: processedEvent
      });
    }

    const { data: latestNotificationEvent, error: latestError } = await supabase
      .from("notification_events")
      .select("*")
      .eq("id", notificationEventId)
      .maybeSingle();

    if (latestError) throw latestError;

    return res.json({
      success: true,
      message: `Notification resend attempted (attempt ${nextRetryCount}/${NOTIFICATION_EVENT_MAX_RETRIES})`,
      notificationEventMaxRetries: NOTIFICATION_EVENT_MAX_RETRIES,
      notificationEvent: latestNotificationEvent || null
    });
  } catch (error) {
    console.error("Notification resend error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resend notification event"
    });
  }
});

router.get("/notification-settings/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Hotel slug is required"
      });
    }

    const { data, error } = await supabase
      .from("hotel_notification_settings")
      .select("*")
      .eq("hotel_slug", slug)
      .maybeSingle();

    if (error) throw error;

    res.json({
      success: true,
      settings: buildNotificationSettingsResponse(data, slug)
    });
  } catch (error) {
    console.error("Notification settings fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification settings"
    });
  }
});

router.get("/payment-route-settings/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Hotel slug is required"
      });
    }

    const { data, error } = await supabase
      .from("hotel_payment_route_settings")
      .select("*")
      .eq("hotel_slug", slug)
      .maybeSingle();

    if (error) {
      if (isMissingPaymentRouteSettingsTableError(error)) {
        return res.json({
          success: true,
          schemaReady: false,
          message: "Payment Route settings table is not initialized yet",
          settings: buildPaymentRouteSettingsResponse(null, slug)
        });
      }

      throw error;
    }

    res.json({
      success: true,
      schemaReady: true,
      settings: buildPaymentRouteSettingsResponse(data, slug)
    });
  } catch (error) {
    console.error("Payment Route settings fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment Route settings"
    });
  }
});


router.get("/hotels", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("hotels")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      hotels: data
    });
  } catch (error) {
    console.error("Admin hotels fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch hotels"
    });
  }
});


router.patch("/orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const status = getAllowedStatus(req.body?.status, ORDER_STATUSES);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${ORDER_STATUSES.join(", ")}`
      });
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Order status updated",
      order: data
    });
  } catch (error) {
    console.error("Order status update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order status"
    });
  }
});

router.patch("/orders/:id/billing", async (req, res) => {
  try {
    const { id } = req.params;
    const { updatePayload, error: validationError } = buildOrderBillingUpdatePayload(req.body);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError
      });
    }

    if (updatePayload.billing_status === "billed") {
      const { data: currentOrder, error: currentOrderError } = await supabase
        .from("orders")
        .select("id,hotel_slug,hotel_name,bill_number")
        .eq("id", id)
        .maybeSingle();

      if (currentOrderError) {
        if (isMissingOrderBillingColumnsError(currentOrderError)) {
          return res.status(400).json({
            success: false,
            message: "Order billing fields are not initialized yet"
          });
        }

        throw currentOrderError;
      }

      if (!currentOrder) {
        return res.status(404).json({
          success: false,
          message: "Order not found"
        });
      }

      if (!currentOrder.bill_number) {
        updatePayload.bill_number = buildOrderBillNumber(
          currentOrder,
          updatePayload.billed_at
        );
      }
    }

    const { data, error } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (isMissingOrderBillingColumnsError(error)) {
        return res.status(400).json({
          success: false,
          message: "Order billing fields are not initialized yet"
        });
      }

      throw error;
    }

    res.json({
      success: true,
      message: "Order billing updated",
      order: data
    });
  } catch (error) {
    console.error("Order billing update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order billing"
    });
  }
});

router.patch("/inquiries/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const status = getAllowedStatus(req.body?.status, INQUIRY_STATUSES);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${INQUIRY_STATUSES.join(", ")}`
      });
    }

    const { data, error } = await supabase
      .from("inquiries")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Inquiry status updated",
      inquiry: data
    });
  } catch (error) {
    console.error("Inquiry status update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update inquiry status"
    });
  }
});

router.patch("/reservations/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const status = getAllowedStatus(req.body?.status, RESERVATION_STATUSES);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${RESERVATION_STATUSES.join(", ")}`
      });
    }

    const { data, error } = await supabase
      .from("reservations")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Reservation status updated",
      reservation: data
    });
  } catch (error) {
    console.error("Reservation status update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update reservation status"
    });
  }
});

router.patch("/hotels/:id/domain", async (req, res) => {
  try {
    const { id } = req.params;
    const { primaryDomain, subdomain, isActive } = req.body;

    const updatePayload = {};

    if (primaryDomain !== undefined) {
      updatePayload.primary_domain = primaryDomain || null;
    }

    if (subdomain !== undefined) {
      updatePayload.subdomain = subdomain || null;
    }

    if (isActive !== undefined) {
      updatePayload.is_active = !!isActive;
    }

    const { data, error } = await supabase
      .from("hotels")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Hotel domain settings updated",
      hotel: data
    });
  } catch (error) {
    console.error("Hotel domain update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update hotel domain settings"
    });
  }
});

router.post("/hotels", validateBody(hotelSchema), async (req, res) => {
  try {
    const {
      slug,
      name,
      whatsappNumber,
      upiId,
      gstPercent,
      primaryDomain,
      subdomain,
      isActive
    } = req.validatedBody;

    const { data, error } = await supabase
      .from("hotels")
      .insert([
        {
          slug,
          name,
          whatsapp_number: whatsappNumber || null,
          upi_id: upiId || null,
          gst_percent: gstPercent ?? 5,
          primary_domain: primaryDomain || null,
          subdomain: subdomain || null,
          is_active: isActive !== undefined ? !!isActive : true
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Hotel created successfully",
      hotel: data
    });
  } catch (error) {
    console.error("Hotel create error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create hotel"
    });
  }
});

router.patch("/hotels/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      slug,
      name,
      whatsappNumber,
      upiId,
      gstPercent,
      primaryDomain,
      subdomain,
      isActive
    } = req.body;

    const updatePayload = {};

    if (slug !== undefined) updatePayload.slug = slug;
    if (name !== undefined) updatePayload.name = name;
    if (whatsappNumber !== undefined) updatePayload.whatsapp_number = whatsappNumber || null;
    if (upiId !== undefined) updatePayload.upi_id = upiId || null;
    if (gstPercent !== undefined) updatePayload.gst_percent = gstPercent;
    if (primaryDomain !== undefined) updatePayload.primary_domain = primaryDomain || null;
    if (subdomain !== undefined) updatePayload.subdomain = subdomain || null;
    if (isActive !== undefined) updatePayload.is_active = !!isActive;

    const { data, error } = await supabase
      .from("hotels")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Hotel updated successfully",
      hotel: data
    });
  } catch (error) {
    console.error("Hotel update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update hotel"
    });
  }
});

router.post("/hotel-profiles", validateBody(hotelProfileSchema), async (req, res) => {
  try {
    const {
      hotelSlug,
      hotelName,
      tagline,
      ownerWhatsAppNumber,
      ownerUpiId,
      gstPercent,
      contact,
      branding,
      theme,
      hero,
      about,
      features,
      events,
      reservation,
      contactSection,
      location,
      footer,
      social
    } = req.validatedBody;

    const { data, error } = await supabase
      .from("hotel_profiles")
      .upsert(
        [
          {
            hotel_slug: hotelSlug,
            hotel_name: hotelName,
            tagline: tagline || "",
            owner_whatsapp_number: ownerWhatsAppNumber || "",
            owner_upi_id: ownerUpiId || "",
            gst_percent: gstPercent ?? 5,
            contact: contact || {},
            branding: branding || {},
            theme: theme || {},
            hero: hero || {},
            about: about || {},
            features: features || [],
            events: events || {},
            reservation: reservation || {},
            contact_section: contactSection || {},
            location: location || {},
            footer: footer || {},
            social: social || {},
            updated_at: new Date().toISOString()
          }
        ],
        { onConflict: "hotel_slug" }
      )
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Hotel profile saved successfully",
      profile: data
    });
  } catch (error) {
    console.error("Hotel profile save error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save hotel profile"
    });
  }
});

router.patch("/contact-submissions/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const status = getAllowedStatus(req.body?.status, CONTACT_SUBMISSION_STATUSES);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${CONTACT_SUBMISSION_STATUSES.join(", ")}`
      });
    }

    const { data, error } = await supabase
      .from("contact_submissions")
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (isMissingContactSubmissionsRelationError(error)) {
        return res.status(400).json({
          success: false,
          message: "Contact submissions table is not initialized yet"
        });
      }

      throw error;
    }

    res.json({
      success: true,
      message: "Contact submission status updated",
      contactSubmission: data
    });
  } catch (error) {
    console.error("Contact submission status update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update contact submission status"
    });
  }
});

router.post(
  "/notification-settings",
  validateBody(hotelNotificationSettingsSchema),
  async (req, res) => {
    try {
      const {
        hotelSlug,
        emailEnabled,
        ownerEmail,
        notifyOnNewOrder,
        notifyOnNewReservation,
        notifyOnNewInquiry
      } = req.validatedBody;

      const { data, error } = await supabase
        .from("hotel_notification_settings")
        .upsert(
          [
            {
              hotel_slug: hotelSlug,
              email_enabled: emailEnabled !== undefined ? !!emailEnabled : false,
              owner_email: ownerEmail ? String(ownerEmail).trim() : null,
              notify_on_new_order:
                notifyOnNewOrder !== undefined ? !!notifyOnNewOrder : true,
              notify_on_new_reservation:
                notifyOnNewReservation !== undefined
                  ? !!notifyOnNewReservation
                  : true,
              notify_on_new_inquiry:
                notifyOnNewInquiry !== undefined ? !!notifyOnNewInquiry : true,
              updated_at: new Date().toISOString()
            }
          ],
          { onConflict: "hotel_slug" }
        )
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        message: "Notification settings saved successfully",
        settings: buildNotificationSettingsResponse(data, hotelSlug)
      });
    } catch (error) {
      console.error("Notification settings save error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to save notification settings"
      });
    }
  }
);

router.post(
  "/payment-route-settings",
  validateBody(hotelPaymentRouteSettingsSchema),
  async (req, res) => {
    try {
      const {
        hotelSlug,
        provider = "razorpay",
        routeEnabled,
        razorpayLinkedAccountId
      } = req.validatedBody;
      const linkedAccountId = String(razorpayLinkedAccountId || "").trim();

      const { data, error } = await supabase
        .from("hotel_payment_route_settings")
        .upsert(
          [
            {
              hotel_slug: hotelSlug,
              provider,
              route_enabled: routeEnabled !== undefined ? !!routeEnabled : false,
              razorpay_linked_account_id: linkedAccountId || null,
              updated_at: new Date().toISOString()
            }
          ],
          { onConflict: "hotel_slug" }
        )
        .select()
        .single();

      if (error) {
        if (isMissingPaymentRouteSettingsTableError(error)) {
          return res.status(400).json({
            success: false,
            message: "Payment Route settings table is not initialized yet"
          });
        }

        throw error;
      }

      res.json({
        success: true,
        message: "Payment Route settings saved successfully",
        settings: buildPaymentRouteSettingsResponse(data, hotelSlug)
      });
    } catch (error) {
      console.error("Payment Route settings save error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to save payment Route settings"
      });
    }
  }
);

router.get("/hotel-profiles/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { data, error } = await supabase
      .from("hotel_profiles")
      .select("*")
      .eq("hotel_slug", slug)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Hotel profile not found"
      });
    }

    res.json({
      success: true,
      profile: data
    });
  } catch (error) {
    console.error("Hotel profile fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch hotel profile"
    });
  }
});

router.get("/menu-items", async (req, res) => {
  try {
    const { hotelSlug } = req.query;

    let query = supabase
      .from("menu_items")
      .select("*")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });

    if (hotelSlug) {
      query = query.eq("hotel_slug", hotelSlug);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      menuItems: data
    });
  } catch (error) {
    console.error("Menu items fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch menu items"
    });
  }
});

router.get("/gallery-items", async (req, res) => {
  try {
    const { hotelSlug } = req.query;

    let query = supabase
      .from("gallery_items")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (hotelSlug) {
      query = query.eq("hotel_slug", hotelSlug);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      galleryItems: data
    });
  } catch (error) {
    console.error("Gallery items fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch gallery items"
    });
  }
});

router.get("/testimonials", async (req, res) => {
  try {
    const { hotelSlug } = req.query;

    let query = supabase
      .from("testimonials")
      .select("*")
      .order("hotel_slug", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (hotelSlug) {
      query = query.eq("hotel_slug", String(hotelSlug).trim());
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.json({
          success: true,
          count: 0,
          testimonials: []
        });
      }

      throw error;
    }

    res.json({
      success: true,
      count: Array.isArray(data) ? data.length : 0,
      testimonials: data || []
    });
  } catch (error) {
    console.error("Testimonials fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch testimonials"
    });
  }
});

router.post("/testimonials", validateBody(testimonialSchema), async (req, res) => {
  try {
    const {
      hotelSlug,
      name,
      role,
      text,
      stars,
      avatar,
      sortOrder,
      isActive,
      isApproved
    } = req.validatedBody;

    const { data, error } = await supabase
      .from("testimonials")
      .insert([
        {
          hotel_slug: hotelSlug,
          guest_name: name,
          guest_role: role || "",
          review_text: text,
          star_rating: Number(stars || 5),
          avatar_url: avatar || "",
          sort_order: Number(sortOrder || 0),
          is_active: isActive !== undefined ? !!isActive : true,
          is_approved: isApproved !== undefined ? !!isApproved : true,
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.status(400).json({
          success: false,
          message: "Testimonials table is not initialized yet"
        });
      }

      throw error;
    }

    res.status(201).json({
      success: true,
      message: "Testimonial created successfully",
      testimonial: data
    });
  } catch (error) {
    console.error("Testimonial create error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create testimonial"
    });
  }
});

router.patch("/testimonials/:id", validateBody(partialTestimonialSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      hotelSlug,
      name,
      role,
      text,
      stars,
      avatar,
      sortOrder,
      isActive,
      isApproved
    } = req.validatedBody;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };

    if (hotelSlug !== undefined) updatePayload.hotel_slug = hotelSlug;
    if (name !== undefined) updatePayload.guest_name = name;
    if (role !== undefined) updatePayload.guest_role = role || "";
    if (text !== undefined) updatePayload.review_text = text;
    if (stars !== undefined) updatePayload.star_rating = Number(stars);
    if (avatar !== undefined) updatePayload.avatar_url = avatar || "";
    if (sortOrder !== undefined) updatePayload.sort_order = Number(sortOrder);
    if (isActive !== undefined) updatePayload.is_active = !!isActive;
    if (isApproved !== undefined) updatePayload.is_approved = !!isApproved;

    if (Object.keys(updatePayload).length === 1) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required to update a testimonial"
      });
    }

    const { data, error } = await supabase
      .from("testimonials")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.status(400).json({
          success: false,
          message: "Testimonials table is not initialized yet"
        });
      }

      throw error;
    }

    res.json({
      success: true,
      message: "Testimonial updated successfully",
      testimonial: data
    });
  } catch (error) {
    console.error("Testimonial update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update testimonial"
    });
  }
});

router.patch("/testimonials/:id/archive", async (req, res) => {
  try {
    const { id } = req.params;
    const { isArchived } = req.body;

    const { data, error } = await supabase
      .from("testimonials")
      .update({
        is_archived: !!isArchived,
        is_active: !!isArchived ? false : true,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.status(400).json({
          success: false,
          message: "Testimonials table is not initialized yet"
        });
      }

      throw error;
    }

    res.json({
      success: true,
      message: !!isArchived ? "Testimonial archived" : "Testimonial restored",
      testimonial: data
    });
  } catch (error) {
    console.error("Testimonial archive error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to archive testimonial"
    });
  }
});

router.patch("/testimonials/:id/approval", async (req, res) => {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;

    const { data, error } = await supabase
      .from("testimonials")
      .update({
        is_approved: !!isApproved,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.status(400).json({
          success: false,
          message: "Testimonials table is not initialized yet"
        });
      }

      throw error;
    }

    res.json({
      success: true,
      message: !!isApproved ? "Testimonial approved" : "Testimonial unapproved",
      testimonial: data
    });
  } catch (error) {
    console.error("Testimonial approval error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update testimonial approval"
    });
  }
});

router.delete("/testimonials/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase.from("testimonials").delete().eq("id", id);

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.status(400).json({
          success: false,
          message: "Testimonials table is not initialized yet"
        });
      }

      throw error;
    }

    res.json({
      success: true,
      message: "Testimonial deleted successfully"
    });
  } catch (error) {
    console.error("Testimonial delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete testimonial"
    });
  }
});

router.post("/menu-items", validateBody(menuItemSchema), async (req, res) => {
  try {
    const {
      hotelSlug,
      category,
      itemId,
      name,
      description,
      price,
      image,
      alt,
      badge,
      tag,
      isAvailable,
      sortOrder
    } = req.validatedBody;

    const { data, error } = await supabase
      .from("menu_items")
      .insert([
        {
          hotel_slug: hotelSlug,
          category,
          item_id: itemId,
          name,
          description: description || "",
          price: Number(price || 0),
          image: image || "",
          alt: alt || "",
          badge: badge || "",
          tag: tag || "",
          is_available: isAvailable !== undefined ? !!isAvailable : true,
          sort_order: Number(sortOrder || 0)
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Menu item created successfully",
      menuItem: data
    });
  } catch (error) {
    console.error("Menu item create error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create menu item"
    });
  }
});

router.post("/gallery-items", validateBody(galleryItemSchema), async (req, res) => {
  try {
    const {
      hotelSlug,
      imageUrl,
      storagePath,
      alt,
      layoutVariant,
      isActive,
      sortOrder
    } = req.validatedBody;

    const { data, error } = await supabase
      .from("gallery_items")
      .insert([
        {
          hotel_slug: hotelSlug,
          image_url: imageUrl,
          storage_path: storagePath || null,
          alt: alt || "",
          layout_variant: layoutVariant || "standard",
          is_active: isActive !== undefined ? !!isActive : true,
          sort_order: Number(sortOrder || 0)
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Gallery item created successfully",
      galleryItem: data
    });
  } catch (error) {
    console.error("Gallery item create error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create gallery item"
    });
  }
});

router.patch("/menu-items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      category,
      itemId,
      name,
      description,
      price,
      image,
      alt,
      badge,
      tag,
      isAvailable,
      sortOrder
    } = req.body;

    const updatePayload = {};

    if (category !== undefined) updatePayload.category = category;
    if (itemId !== undefined) updatePayload.item_id = itemId;
    if (name !== undefined) updatePayload.name = name;
    if (description !== undefined) updatePayload.description = description;
    if (price !== undefined) updatePayload.price = Number(price);
    if (image !== undefined) updatePayload.image = image;
    if (alt !== undefined) updatePayload.alt = alt;
    if (badge !== undefined) updatePayload.badge = badge;
    if (tag !== undefined) updatePayload.tag = tag;
    if (isAvailable !== undefined) updatePayload.is_available = !!isAvailable;
    if (sortOrder !== undefined) updatePayload.sort_order = Number(sortOrder);

    const { data, error } = await supabase
      .from("menu_items")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Menu item updated successfully",
      menuItem: data
    });
  } catch (error) {
    console.error("Menu item update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update menu item"
    });
  }
});

router.patch("/gallery-items/:id", validateBody(partialGalleryItemSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      hotelSlug,
      imageUrl,
      storagePath,
      alt,
      layoutVariant,
      isActive,
      sortOrder
    } = req.validatedBody;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };

    if (hotelSlug !== undefined) updatePayload.hotel_slug = hotelSlug;
    if (imageUrl !== undefined) updatePayload.image_url = imageUrl;
    if (storagePath !== undefined) updatePayload.storage_path = storagePath || null;
    if (alt !== undefined) updatePayload.alt = alt || "";
    if (layoutVariant !== undefined) updatePayload.layout_variant = layoutVariant;
    if (isActive !== undefined) updatePayload.is_active = !!isActive;
    if (sortOrder !== undefined) updatePayload.sort_order = Number(sortOrder);

    if (Object.keys(updatePayload).length === 1) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required to update a gallery item"
      });
    }

    const { data, error } = await supabase
      .from("gallery_items")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Gallery item updated successfully",
      galleryItem: data
    });
  } catch (error) {
    console.error("Gallery item update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update gallery item"
    });
  }
});

router.patch("/menu-items/:id/archive", async (req, res) => {
  try {
    const { id } = req.params;
    const { isArchived } = req.body;

    const { data, error } = await supabase
      .from("menu_items")
      .update({
        is_archived: !!isArchived,
        is_available: !!isArchived ? false : true
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: isArchived ? "Menu item archived" : "Menu item restored",
      menuItem: data
    });
  } catch (error) {
    console.error("Menu item archive error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to archive menu item"
    });
  }
});

router.patch("/gallery-items/:id/archive", async (req, res) => {
  try {
    const { id } = req.params;
    const { isArchived } = req.body;

    const { data, error } = await supabase
      .from("gallery_items")
      .update({
        is_archived: !!isArchived,
        is_active: !!isArchived ? false : true,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: isArchived ? "Gallery item archived" : "Gallery item restored",
      galleryItem: data
    });
  } catch (error) {
    console.error("Gallery item archive error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to archive gallery item"
    });
  }
});

router.delete("/menu-items/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("menu_items")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({
      success: true,
      message: "Menu item deleted successfully"
    });
  } catch (error) {
    console.error("Menu item delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete menu item"
    });
  }
});

router.patch("/gallery-items/:id/active", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const { data, error } = await supabase
      .from("gallery_items")
      .update({
        is_active: !!isActive,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: isActive ? "Gallery item activated" : "Gallery item deactivated",
      galleryItem: data
    });
  } catch (error) {
    console.error("Gallery item active toggle error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update gallery item active state"
    });
  }
});

router.delete("/gallery-items/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("gallery_items")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({
      success: true,
      message: "Gallery item deleted successfully"
    });
  } catch (error) {
    console.error("Gallery item delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete gallery item"
    });
  }
});

router.patch("/hotels/:id/active", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const { data, error } = await supabase
      .from("hotels")
      .update({
        is_active: !!isActive
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: isActive ? "Hotel activated" : "Hotel deactivated",
      hotel: data
    });
  } catch (error) {
    console.error("Hotel active toggle error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update hotel active state"
    });
  }
});

module.exports = router;
