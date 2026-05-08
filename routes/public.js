const express = require("express");
const { supabase } = require("../utils/supabase");
const { ensurePublicHotelAccess } = require("../utils/public-hotel-access");

const router = express.Router();
const PUBLIC_ROUTE_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120";
const PUBLIC_ROUTE_CACHE_TTL_MS = 30 * 1000;
const publicRouteCache = new Map();

const PUBLIC_HOTEL_PROFILE_FIELDS = [
  "hotel_slug",
  "hotel_name",
  "tagline",
  "owner_whatsapp_number",
  "owner_upi_id",
  "gst_percent",
  "contact",
  "branding",
  "theme",
  "hero",
  "about",
  "features",
  "events",
  "reservation",
  "contact_section",
  "location",
  "footer",
  "social"
].join(",");

const PUBLIC_MENU_FIELDS = [
  "item_id",
  "name",
  "description",
  "price",
  "image",
  "alt",
  "badge",
  "tag",
  "category",
  "sort_order"
].join(",");

const PUBLIC_GALLERY_FIELDS = [
  "id",
  "image_url",
  "storage_path",
  "alt",
  "layout_variant",
  "sort_order"
].join(",");

const PUBLIC_TESTIMONIAL_FIELDS = [
  "id",
  "hotel_slug",
  "guest_name",
  "guest_role",
  "review_text",
  "star_rating",
  "avatar_url",
  "sort_order",
  "created_at",
  "is_archived",
  "is_active",
  "is_approved"
].join(",");

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

function getCachedPublicRoutePayload(cacheKey) {
  const cachedEntry = publicRouteCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    publicRouteCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.payload;
}

function setCachedPublicRoutePayload(cacheKey, payload) {
  publicRouteCache.set(cacheKey, {
    expiresAt: Date.now() + PUBLIC_ROUTE_CACHE_TTL_MS,
    payload
  });
}

router.get("/hotel/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const hotelAccess = await ensurePublicHotelAccess(req, res, slug);

    if (!hotelAccess) {
      return;
    }

    const cacheKey = `hotel:${slug}`;
    const cachedPayload = getCachedPublicRoutePayload(cacheKey);

    if (cachedPayload) {
      res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
      return res.json(cachedPayload);
    }

    const { data, error } = await supabase
      .from("hotel_profiles")
      .select(PUBLIC_HOTEL_PROFILE_FIELDS)
      .eq("hotel_slug", slug)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Hotel profile not found"
      });
    }

    const payload = {
      success: true,
      hotel: data
    };

    setCachedPublicRoutePayload(cacheKey, payload);
    res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
    res.json(payload);
  } catch (error) {
    console.error("Public hotel fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch hotel profile"
    });
  }
});

router.get("/menu/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const hotelAccess = await ensurePublicHotelAccess(req, res, slug);

    if (!hotelAccess) {
      return;
    }

    const cacheKey = `menu:${slug}`;
    const cachedPayload = getCachedPublicRoutePayload(cacheKey);

    if (cachedPayload) {
      res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
      return res.json(cachedPayload);
    }

    const { data, error } = await supabase
      .from("menu_items")
      .select(PUBLIC_MENU_FIELDS)
      .eq("hotel_slug", slug)
      .eq("is_available", true)
      .eq("is_archived", false)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const groupedMenu = {};

    for (const item of data || []) {
      const category = item.category || "others";

      if (!groupedMenu[category]) {
        groupedMenu[category] = [];
      }

      groupedMenu[category].push({
        id: item.item_id,
        name: item.name,
        desc: item.description || "",
        price: Number(item.price || 0),
        image: item.image || "",
        alt: item.alt || item.name || "",
        badge: item.badge || "",
        tag: item.tag || ""
      });
    }

    const payload = {
      success: true,
      menu: groupedMenu
    };

    setCachedPublicRoutePayload(cacheKey, payload);
    res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
    res.json(payload);
  } catch (error) {
    console.error("Public menu fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch menu"
    });
  }
});

router.get("/gallery/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const hotelAccess = await ensurePublicHotelAccess(req, res, slug);

    if (!hotelAccess) {
      return;
    }

    const cacheKey = `gallery:${slug}`;
    const cachedPayload = getCachedPublicRoutePayload(cacheKey);

    if (cachedPayload) {
      res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
      return res.json(cachedPayload);
    }

    const { data, error } = await supabase
      .from("gallery_items")
      .select(PUBLIC_GALLERY_FIELDS)
      .eq("hotel_slug", slug)
      .eq("is_active", true)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw error;

    const payload = {
      success: true,
      gallery: (data || []).map((item) => ({
        id: item.id,
        imageUrl: item.image_url || "",
        storagePath: item.storage_path || "",
        alt: item.alt || "",
        layoutVariant: item.layout_variant || "standard",
        sortOrder: Number(item.sort_order || 0)
      }))
    };

    setCachedPublicRoutePayload(cacheKey, payload);
    res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
    res.json(payload);
  } catch (error) {
    console.error("Public gallery fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch gallery"
    });
  }
});

router.get("/testimonials/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const hotelAccess = await ensurePublicHotelAccess(req, res, slug);

    if (!hotelAccess) {
      return;
    }

    const cacheKey = `testimonials:${slug}`;
    const cachedPayload = getCachedPublicRoutePayload(cacheKey);

    if (cachedPayload) {
      res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
      return res.json(cachedPayload);
    }

    const { data, error } = await supabase
      .from("testimonials")
      .select(PUBLIC_TESTIMONIAL_FIELDS)
      .eq("hotel_slug", slug);

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        const payload = {
          success: true,
          testimonials: []
        };

        setCachedPublicRoutePayload(cacheKey, payload);
        res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
        return res.json(payload);
      }

      throw error;
    }

    const testimonials = (data || [])
      .filter(
        (item) =>
          item &&
          item.is_archived !== true &&
          item.is_active !== false &&
          item.is_approved !== false
      )
      .sort((left, right) => {
        const leftSort = Number.isFinite(Number(left?.sort_order)) ? Number(left.sort_order) : 0;
        const rightSort = Number.isFinite(Number(right?.sort_order)) ? Number(right.sort_order) : 0;

        if (leftSort !== rightSort) {
          return leftSort - rightSort;
        }

        const leftCreated = Date.parse(left?.created_at || "") || 0;
        const rightCreated = Date.parse(right?.created_at || "") || 0;

        return rightCreated - leftCreated;
      })
      .map((item) => ({
        id: item.id,
        hotelSlug: item.hotel_slug || slug,
        name: item.guest_name || item.name || "",
        role: item.guest_role || item.role || "",
        text: item.review_text || item.text || "",
        stars: Number(item.star_rating ?? item.stars ?? 5) || 5,
        avatar: item.avatar_url || item.avatar || ""
      }))
      .filter((item) => item.name && item.text);

    const payload = {
      success: true,
      testimonials
    };

    setCachedPublicRoutePayload(cacheKey, payload);
    res.set("Cache-Control", PUBLIC_ROUTE_CACHE_CONTROL);
    res.json(payload);
  } catch (error) {
    console.error("Public testimonials fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch testimonials"
    });
  }
});

module.exports = router;
