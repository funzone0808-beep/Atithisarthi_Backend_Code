const { supabase } = require("./supabase");

const DEFAULT_ORDERING_DISABLED_TITLE = "We're Not Accepting Online Orders";
const DEFAULT_ORDERING_DISABLED_MESSAGE =
  "We're unable to receive online orders right now. Please visit the restaurant or contact us directly.";
const ORDERING_SETTINGS_CACHE_TTL_MS = 15 * 1000;
const orderingSettingsCache = new Map();

function normalizeOrderingText(value = "", maxLength = 300) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength)
    : "";
}

function normalizeOrderingLink(value = "") {
  const candidate = normalizeOrderingText(value, 2000);

  if (!candidate) {
    return "";
  }

  if (candidate.startsWith("/")) {
    return candidate;
  }

  try {
    const parsedUrl = new URL(candidate);
    return ["http:", "https:"].includes(parsedUrl.protocol) ? parsedUrl.toString() : "";
  } catch {
    return "";
  }
}

function isMissingHotelOrderingSettingsTableError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (details.includes("hotel_ordering_settings") &&
      (details.includes("relation") ||
        details.includes("schema cache") ||
        details.includes("could not find")))
  );
}

function buildHotelOrderingSettings(settingsRow, hotelSlug = "", options = {}) {
  const schemaReady = options.schemaReady !== false;

  return {
    exists: !!settingsRow,
    schemaReady,
    hotelSlug: normalizeOrderingText(settingsRow?.hotel_slug || hotelSlug, 120),
    customerOrderingEnabled:
      settingsRow?.customer_ordering_enabled !== undefined
        ? !!settingsRow.customer_ordering_enabled
        : true,
    staffOrderingEnabled:
      settingsRow?.staff_ordering_enabled !== undefined
        ? !!settingsRow.staff_ordering_enabled
        : true,
    enforceTableMaster: settingsRow?.enforce_table_master === true,
    secureOnlinePaymentEnabled:
      settingsRow?.secure_online_payment_enabled !== undefined
        ? !!settingsRow.secure_online_payment_enabled
        : true,
    cashOnDeliveryEnabled:
      settingsRow?.cash_on_delivery_enabled !== undefined
        ? !!settingsRow.cash_on_delivery_enabled
        : true,
    manualUpiPaymentEnabled:
      settingsRow?.manual_upi_payment_enabled !== undefined
        ? !!settingsRow.manual_upi_payment_enabled
        : true,
    whatsappOrderingEnabled:
      settingsRow?.whatsapp_ordering_enabled !== undefined
        ? !!settingsRow.whatsapp_ordering_enabled
        : true,
    disabledTitle:
      normalizeOrderingText(settingsRow?.disabled_title, 160) ||
      DEFAULT_ORDERING_DISABLED_TITLE,
    disabledMessage:
      normalizeOrderingText(settingsRow?.disabled_message, 1000) ||
      DEFAULT_ORDERING_DISABLED_MESSAGE,
    disabledButtonText: normalizeOrderingText(settingsRow?.disabled_button_text, 120),
    disabledButtonLink: normalizeOrderingLink(settingsRow?.disabled_button_link),
    disabledIcon: normalizeOrderingText(settingsRow?.disabled_icon, 40)
  };
}

function buildCustomerOrderingDisabledPayload(settings = {}) {
  const normalizedSettings =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings
      : {};

  const title =
    normalizeOrderingText(normalizedSettings.disabledTitle, 160) ||
    DEFAULT_ORDERING_DISABLED_TITLE;
  const message =
    normalizeOrderingText(normalizedSettings.disabledMessage, 1000) ||
    DEFAULT_ORDERING_DISABLED_MESSAGE;

  return {
    success: false,
    code: "ORDERING_DISABLED",
    message,
    ordering: {
      customerOrderingEnabled: false,
      whatsappOrderingEnabled: normalizedSettings.whatsappOrderingEnabled !== false,
      title,
      message,
      buttonText: normalizeOrderingText(normalizedSettings.disabledButtonText, 120),
      buttonLink: normalizeOrderingLink(normalizedSettings.disabledButtonLink),
      icon: normalizeOrderingText(normalizedSettings.disabledIcon, 40)
    }
  };
}

function buildStaffOrderingDisabledPayload(settings = {}) {
  const normalizedSettings =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings
      : {};

  const title =
    normalizeOrderingText(normalizedSettings.disabledTitle, 160) ||
    "Staff Ordering is Currently Unavailable";
  const message =
    normalizeOrderingText(normalizedSettings.disabledMessage, 1000) ||
    "This hotel is not accepting staff-assisted orders right now. Please check with the manager and try again later.";

  return {
    success: false,
    code: "STAFF_ORDERING_DISABLED",
    message,
    ordering: {
      staffOrderingEnabled: false,
      title,
      message,
      icon: normalizeOrderingText(normalizedSettings.disabledIcon, 40)
    }
  };
}

function normalizePaymentMethod(value = "") {
  const method = normalizeOrderingText(value, 80).toLowerCase();
  if (method === "cod" || method.includes("cash on delivery")) return "cod";
  if (method === "upi" || method.includes("google pay") || method.includes("gpay")) return "manual_upi";
  if (method === "online_gateway" || method.includes("online payment") || method.includes("razorpay")) return "secure_online";
  return "";
}

function isHotelPaymentMethodEnabled(settings = {}, paymentMethod = "") {
  const method = normalizePaymentMethod(paymentMethod);
  if (method === "cod") return settings.cashOnDeliveryEnabled !== false;
  if (method === "manual_upi") return settings.manualUpiPaymentEnabled !== false;
  if (method === "secure_online") return settings.secureOnlinePaymentEnabled !== false;
  return false;
}

function buildPaymentMethodDisabledPayload(settings = {}, paymentMethod = "") {
  const method = normalizePaymentMethod(paymentMethod);
  const labels = {
    cod: "COD / Cash on Delivery",
    manual_upi: "Google Pay / UPI",
    secure_online: "Secure Online Payment"
  };
  return {
    success: false,
    code: "PAYMENT_METHOD_DISABLED",
    message: `${labels[method] || "The selected payment method"} is not enabled for this hotel. Please choose another available method.`,
    paymentMethods: {
      secureOnlinePaymentEnabled: settings.secureOnlinePaymentEnabled !== false,
      cashOnDeliveryEnabled: settings.cashOnDeliveryEnabled !== false,
      manualUpiPaymentEnabled: settings.manualUpiPaymentEnabled !== false
    }
  };
}

function invalidateHotelOrderingSettings(hotelSlug = "") {
  orderingSettingsCache.delete(normalizeOrderingText(hotelSlug, 120));
}

async function fetchHotelOrderingSettings(hotelSlug = "") {
  const normalizedHotelSlug = normalizeOrderingText(hotelSlug, 120);

  if (!normalizedHotelSlug) {
    return buildHotelOrderingSettings(null, "");
  }

  const cached = orderingSettingsCache.get(normalizedHotelSlug);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  if (cached) orderingSettingsCache.delete(normalizedHotelSlug);

  const { data, error } = await supabase
    .from("hotel_ordering_settings")
    .select("*")
    .eq("hotel_slug", normalizedHotelSlug)
    .maybeSingle();

  if (error) {
    if (isMissingHotelOrderingSettingsTableError(error)) {
      return buildHotelOrderingSettings(null, normalizedHotelSlug, {
        schemaReady: false
      });
    }

    throw error;
  }

  const settings = buildHotelOrderingSettings(data, normalizedHotelSlug);
  orderingSettingsCache.set(normalizedHotelSlug, {
    settings,
    expiresAt: Date.now() + ORDERING_SETTINGS_CACHE_TTL_MS
  });
  return settings;
}

module.exports = {
  buildCustomerOrderingDisabledPayload,
  buildStaffOrderingDisabledPayload,
  buildPaymentMethodDisabledPayload,
  DEFAULT_ORDERING_DISABLED_MESSAGE,
  DEFAULT_ORDERING_DISABLED_TITLE,
  buildHotelOrderingSettings,
  fetchHotelOrderingSettings,
  invalidateHotelOrderingSettings,
  isHotelPaymentMethodEnabled,
  isMissingHotelOrderingSettingsTableError,
  normalizePaymentMethod,
  normalizeOrderingLink,
  normalizeOrderingText
};
