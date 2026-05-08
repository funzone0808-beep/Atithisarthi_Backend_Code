const express = require("express");
const { supabase } = require("../utils/supabase");
const { ensurePublicHotelAccess } = require("../utils/public-hotel-access");
const { publicAssistantLimiter } = require("../middleware/public-rate-limiters");
const { validateBody } = require("../validators/common");
const { menuAssistantRequestSchema } = require("../validators/public");
const { buildGroundedMenuAssistantReply } = require("../utils/menu-assistant");
const {
  buildReadOnlyTrackingAssistantReply,
  detectReadOnlyTrackingAssistantIntent,
  hasReadOnlyTrackingAssistantContext
} = require("../utils/tracking-assistant");

const router = express.Router();
const PUBLIC_ASSISTANT_HOTEL_FIELDS = [
  "hotel_slug",
  "hotel_name",
  "tagline",
  "theme"
].join(",");
const PUBLIC_ASSISTANT_MENU_FIELDS = [
  "item_id",
  "name",
  "description",
  "price",
  "badge",
  "tag",
  "category",
  "sort_order"
].join(",");
const TRACKING_ASSISTANT_ORDER_FIELDS = [
  "id",
  "hotel_slug",
  "hotel_name",
  "order_type",
  "table_number",
  "order_source",
  "payment_status",
  "billing_status",
  "bill_number",
  "status"
].join(",");

function normalizeAssistantTone(value = "") {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["friendly", "formal"].includes(candidate) ? candidate : "default";
}

function buildAssistantDisclaimer(context = {}, tone = "default") {
  const pageScope =
    typeof context?.pageScope === "string" ? context.pageScope.trim().toLowerCase() : "";
  const orderType =
    typeof context?.orderType === "string" ? context.orderType.trim().toLowerCase() : "";
  const tableNumber =
    typeof context?.tableNumber === "string" ? context.tableNumber.trim() : "";
  const trackingOrderId =
    typeof context?.trackingOrderId === "string" ? context.trackingOrderId.trim() : "";
  const trackingToken =
    typeof context?.trackingToken === "string" ? context.trackingToken.trim() : "";

  if (pageScope === "order_tracking" && trackingOrderId && trackingToken) {
    if (tone === "friendly") {
      return "I can safely read only this tracking page's token-scoped order status, bill readiness, and add-more availability. I do not create requests or change the order here.";
    }

    if (tone === "formal") {
      return "This assistant may read only this tracking page's token-scoped order status, bill readiness, and add-more availability. It does not create requests or modify the order.";
    }

    return "This assistant can read only this tracking page's token-scoped order status, bill readiness, and add-more availability. It does not create requests or change the order.";
  }

  if (tableNumber && (orderType === "dine-in" || orderType === "dinein")) {
    if (tone === "friendly") {
      return "I am using only this hotel's current live menu here, and I cannot handle live order status, bill requests, or staff calls inside Smart Waiter yet.";
    }

    if (tone === "formal") {
      return "This assistant is limited to the current hotel's active menu and does not process live order status, bill requests, or staff-call actions.";
    }

    return "This assistant only uses the current hotel's active menu and does not handle live order status, bill requests, or staff calls.";
  }

  if (tone === "friendly") {
    return "I am using only this hotel's current live menu and can suggest safe on-page actions like adding items to the cart.";
  }

  if (tone === "formal") {
    return "This assistant is limited to the current hotel's active menu and may suggest safe on-page actions only.";
  }

  return "This assistant only uses the current hotel's active menu and suggests safe UI actions.";
}

router.post(
  "/menu/:slug",
  publicAssistantLimiter,
  validateBody(menuAssistantRequestSchema),
  async (req, res) => {
    try {
      const { slug } = req.params;
      const { message, context } = req.validatedBody;
      const hotelAccess = await ensurePublicHotelAccess(req, res, slug, {
        notFoundMessage: "Hotel menu assistant is not available for this hotel",
        forbiddenMessage: "This assistant is not available from the current origin"
      });

      if (!hotelAccess) {
        return;
      }

      const trackingIntent = detectReadOnlyTrackingAssistantIntent(message);
      const shouldAttemptTrackingAssistantReply =
        !!trackingIntent && hasReadOnlyTrackingAssistantContext(context);
      const trackingLookup = shouldAttemptTrackingAssistantReply
        ? supabase
            .from("orders")
            .select(TRACKING_ASSISTANT_ORDER_FIELDS)
            .eq("hotel_slug", slug)
            .eq("id", context.trackingOrderId)
            .eq("tracking_token", context.trackingToken)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [
        { data: hotelProfile, error: hotelError },
        { data: menuItems, error: menuError },
        { data: trackedOrder, error: trackedOrderError }
      ] =
        await Promise.all([
          supabase
            .from("hotel_profiles")
            .select(PUBLIC_ASSISTANT_HOTEL_FIELDS)
            .eq("hotel_slug", slug)
            .maybeSingle(),
          supabase
            .from("menu_items")
            .select(PUBLIC_ASSISTANT_MENU_FIELDS)
            .eq("hotel_slug", slug)
            .eq("is_available", true)
            .eq("is_archived", false)
            .order("category", { ascending: true })
            .order("sort_order", { ascending: true }),
          trackingLookup
        ]);

      if (hotelError) {
        throw hotelError;
      }

      if (menuError) {
        throw menuError;
      }

      const rawAssistantTheme =
        hotelProfile?.theme &&
        typeof hotelProfile.theme === "object" &&
        !Array.isArray(hotelProfile.theme)
          ? hotelProfile.theme.aiAssistant
          : null;
      const assistantThemeConfig =
        rawAssistantTheme &&
        typeof rawAssistantTheme === "object" &&
        !Array.isArray(rawAssistantTheme)
          ? rawAssistantTheme
          : {};
      const assistantTone = normalizeAssistantTone(assistantThemeConfig.tone);

      if (assistantThemeConfig.enabled === false) {
        return res.status(404).json({
          success: false,
          message: "Menu assistant is disabled for this hotel"
        });
      }

      const normalizedMenuItems = Array.isArray(menuItems) ? menuItems : [];

      if (trackedOrderError) {
        console.warn("Public assistant tracking lookup skipped:", trackedOrderError.message);
      }

      const trackingAssistantReply = buildReadOnlyTrackingAssistantReply({
        hotelName: hotelProfile?.hotel_name || slug,
        message,
        context,
        trackedOrder,
        tone: assistantTone
      });

      if (trackingAssistantReply) {
        return res.json({
          success: true,
          assistant: {
            hotelSlug: slug,
            hotelName: hotelProfile?.hotel_name || slug,
            tagline: hotelProfile?.tagline || "",
            disclaimer: buildAssistantDisclaimer(context, assistantTone),
            ...trackingAssistantReply
          }
        });
      }

      if (!normalizedMenuItems.length) {
        return res.status(404).json({
          success: false,
          message: "No active menu items are available for this hotel"
        });
      }

      const assistant = buildGroundedMenuAssistantReply({
        hotelName: hotelProfile?.hotel_name || slug,
        message,
        menuItems: normalizedMenuItems,
        context,
        tone: assistantTone
      });

        return res.json({
          success: true,
          assistant: {
            hotelSlug: slug,
            hotelName: hotelProfile?.hotel_name || slug,
            tagline: hotelProfile?.tagline || "",
            disclaimer: buildAssistantDisclaimer(context, assistantTone),
            ...assistant
          }
        });
    } catch (error) {
      console.error("Public menu assistant error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to generate menu assistant reply"
      });
    }
  }
);

module.exports = router;
