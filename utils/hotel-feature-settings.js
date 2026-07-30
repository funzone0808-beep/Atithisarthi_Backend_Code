const HOTEL_FEATURE_KEYS = Object.freeze({
  FOOD: "food",
  ROOMS: "rooms",
  ROOM_SERVICE: "room_service",
  FOOD_REPORTS: "food_reports",
  ROOM_REPORTS: "room_reports",
  COMBINED_REPORTS: "combined_reports",
  COMBINED_BILLING: "combined_billing"
});

const FEATURE_LABELS = Object.freeze({
  [HOTEL_FEATURE_KEYS.FOOD]: "Food Operations",
  [HOTEL_FEATURE_KEYS.ROOMS]: "Room Operations",
  [HOTEL_FEATURE_KEYS.ROOM_SERVICE]: "Room Service",
  [HOTEL_FEATURE_KEYS.FOOD_REPORTS]: "Food Reports",
  [HOTEL_FEATURE_KEYS.ROOM_REPORTS]: "Room Reports",
  [HOTEL_FEATURE_KEYS.COMBINED_REPORTS]: "Combined Reports",
  [HOTEL_FEATURE_KEYS.COMBINED_BILLING]: "Combined Billing"
});

function normalizeHotelSlug(value = "") {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120)
    : "";
}

function hasOwn(record, key) {
  return !!record && Object.prototype.hasOwnProperty.call(record, key);
}

function readBoolean(record, keys = [], fallback = false) {
  for (const key of keys) {
    if (hasOwn(record, key) && record[key] !== undefined && record[key] !== null) {
      return record[key] === true;
    }
  }

  return fallback;
}

function getHotelBusinessType({ enableFoodModule, enableRoomModule } = {}) {
  if (enableFoodModule && enableRoomModule) return "hotel_restaurant";
  if (enableRoomModule) return "hotel_only";
  return "restaurant_only";
}

function normalizeHotelFeatureConfig(row = {}, hotelSlug = "") {
  const enableFoodModule = readBoolean(
    row,
    ["enable_food_module", "enableFoodModule"],
    true
  );
  const enableRoomModule = readBoolean(
    row,
    ["enable_room_module", "enableRoomModule"],
    readBoolean(row, ["enable_room_booking", "enableRoomBooking"], false)
  );
  const enableFoodOrdering =
    enableFoodModule &&
    readBoolean(row, ["enable_food_ordering", "enableFoodOrdering"], true);
  const enableRoomBooking =
    enableRoomModule &&
    readBoolean(row, ["enable_room_booking", "enableRoomBooking"], enableRoomModule);
  const enableRoomService =
    enableFoodModule &&
    enableRoomModule &&
    readBoolean(row, ["enable_room_service", "enableRoomService"], false);
  const enableFoodReports =
    enableFoodModule &&
    readBoolean(row, ["enable_food_reports", "enableFoodReports"], enableFoodModule);
  const enableRoomReports =
    enableRoomModule &&
    readBoolean(row, ["enable_room_reports", "enableRoomReports"], enableRoomModule);
  const enableCombinedReports =
    enableFoodModule &&
    enableRoomModule &&
    readBoolean(row, ["enable_combined_reports", "enableCombinedReports"], false);
  const enableCombinedBilling =
    enableRoomService &&
    readBoolean(row, ["enable_combined_billing", "enableCombinedBilling"], false);

  const config = {
    hotelSlug: normalizeHotelSlug(row.hotel_slug || row.hotelSlug || hotelSlug),
    enableFoodModule,
    enableRoomModule,
    enableRoomService,
    enableFoodReports,
    enableRoomReports,
    enableCombinedReports,
    enableCombinedBilling,
    enableFoodOrdering,
    enableRoomBooking,
    version: Math.max(1, Number(row.version || 1) || 1),
    updatedAt: row.updated_at || row.updatedAt || "",
    updatedBy: row.updated_by || row.updatedBy || ""
  };

  return {
    ...config,
    businessType: getHotelBusinessType(config),
    canUseFood: config.enableFoodModule,
    canUseRooms: config.enableRoomModule,
    canUseRoomService: config.enableRoomService,
    canUseFoodReports: config.enableFoodReports,
    canUseRoomReports: config.enableRoomReports,
    canUseCombinedReports: config.enableCombinedReports,
    canUseCombinedBilling: config.enableCombinedBilling
  };
}

function buildHotelFeatureSettingsRow(input = {}, options = {}) {
  const normalized = normalizeHotelFeatureConfig(input, input.hotelSlug || input.hotel_slug);

  return {
    hotel_slug: normalized.hotelSlug,
    enable_food_module: normalized.enableFoodModule,
    enable_room_module: normalized.enableRoomModule,
    enable_room_service: normalized.enableRoomService,
    enable_food_reports: normalized.enableFoodReports,
    enable_room_reports: normalized.enableRoomReports,
    enable_combined_reports: normalized.enableCombinedReports,
    enable_combined_billing: normalized.enableCombinedBilling,
    enable_food_ordering: normalized.enableFoodOrdering,
    enable_room_booking: normalized.enableRoomBooking,
    version: Math.max(1, Number(options.version || input.version || 1) || 1),
    updated_by: String(options.updatedBy || input.updatedBy || "").trim().slice(0, 160) || null,
    updated_at: options.updatedAt || new Date().toISOString()
  };
}

function isMissingHotelFeatureSchemaError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    details.includes("hotel_feature_settings") ||
    details.includes("enable_food_module") ||
    details.includes("enable_room_module")
  );
}

async function fetchHotelFeatureConfig(supabaseClient, hotelSlug = "") {
  const safeHotelSlug = normalizeHotelSlug(hotelSlug);

  if (!safeHotelSlug) {
    const error = new Error("Hotel scope is required for feature resolution");
    error.code = "HOTEL_SCOPE_REQUIRED";
    throw error;
  }

  const { data, error } = await supabaseClient
    .from("hotel_feature_settings")
    .select("*")
    .eq("hotel_slug", safeHotelSlug)
    .maybeSingle();

  if (error) throw error;
  return normalizeHotelFeatureConfig(data || {}, safeHotelSlug);
}

function isHotelFeatureEnabled(config = {}, featureKey = "") {
  const normalized = normalizeHotelFeatureConfig(config, config.hotelSlug || config.hotel_slug);
  const capabilityByFeature = {
    [HOTEL_FEATURE_KEYS.FOOD]: normalized.canUseFood,
    [HOTEL_FEATURE_KEYS.ROOMS]: normalized.canUseRooms,
    [HOTEL_FEATURE_KEYS.ROOM_SERVICE]: normalized.canUseRoomService,
    [HOTEL_FEATURE_KEYS.FOOD_REPORTS]: normalized.canUseFoodReports,
    [HOTEL_FEATURE_KEYS.ROOM_REPORTS]: normalized.canUseRoomReports,
    [HOTEL_FEATURE_KEYS.COMBINED_REPORTS]: normalized.canUseCombinedReports,
    [HOTEL_FEATURE_KEYS.COMBINED_BILLING]: normalized.canUseCombinedBilling
  };

  return capabilityByFeature[featureKey] === true;
}

function buildFeatureDisabledPayload(featureKey = "") {
  const label = FEATURE_LABELS[featureKey] || "This module";

  return {
    success: false,
    code: "FEATURE_DISABLED",
    feature: featureKey,
    message: `${label} are not enabled for this hotel.`
  };
}

module.exports = {
  HOTEL_FEATURE_KEYS,
  FEATURE_LABELS,
  normalizeHotelSlug,
  normalizeHotelFeatureConfig,
  buildHotelFeatureSettingsRow,
  isMissingHotelFeatureSchemaError,
  fetchHotelFeatureConfig,
  isHotelFeatureEnabled,
  buildFeatureDisabledPayload
};
