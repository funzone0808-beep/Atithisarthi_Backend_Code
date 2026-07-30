const {
  buildFeatureDisabledPayload,
  fetchHotelFeatureConfig,
  isHotelFeatureEnabled,
  isMissingHotelFeatureSchemaError,
  normalizeHotelSlug
} = require("../utils/hotel-feature-settings");

function getDefaultSupabaseClient() {
  return require("../utils/supabase").supabase;
}

function resolveStaffHotelSlug(req = {}) {
  return normalizeHotelSlug(req.staffHotelSlug || req.staffUser?.hotelSlug);
}

function resolveAdminHotelSlug(req = {}) {
  return normalizeHotelSlug(
    req.validatedBody?.hotelSlug ||
      req.body?.hotelSlug ||
      req.query?.hotelSlug ||
      req.params?.slug
  );
}

function resolvePublicHotelSlug(req = {}) {
  return normalizeHotelSlug(
    req.validatedBody?.hotelSlug ||
      req.params?.slug ||
      req.body?.hotelSlug
  );
}

function buildFeatureSchemaUnavailablePayload() {
  return {
    success: false,
    code: "FEATURE_CONFIGURATION_UNAVAILABLE",
    schemaReady: false,
    message: "Hotel feature configuration is not initialized yet"
  };
}

function requireHotelFeature(
  featureKey,
  {
    resolveHotelSlug = resolveStaffHotelSlug,
    supabaseClient = null
  } = {}
) {
  return async function requireHotelFeatureMiddleware(req, res, next) {
    const hotelSlug = normalizeHotelSlug(await resolveHotelSlug(req));

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        code: "HOTEL_SCOPE_REQUIRED",
        message: "Hotel scope is required"
      });
    }

    try {
      const featureConfig = await fetchHotelFeatureConfig(
        supabaseClient || getDefaultSupabaseClient(),
        hotelSlug
      );
      req.hotelFeatureConfig = featureConfig;

      if (!isHotelFeatureEnabled(featureConfig, featureKey)) {
        return res.status(403).json(buildFeatureDisabledPayload(featureKey));
      }

      return next();
    } catch (error) {
      if (isMissingHotelFeatureSchemaError(error)) {
        return res.status(503).json(buildFeatureSchemaUnavailablePayload());
      }

      return next(error);
    }
  };
}

async function ensureHotelFeatureEnabled(
  res,
  {
    featureKey,
    hotelSlug,
    supabaseClient = null
  } = {}
) {
  try {
    const featureConfig = await fetchHotelFeatureConfig(
      supabaseClient || getDefaultSupabaseClient(),
      hotelSlug
    );

    if (!isHotelFeatureEnabled(featureConfig, featureKey)) {
      res.status(403).json(buildFeatureDisabledPayload(featureKey));
      return null;
    }

    return featureConfig;
  } catch (error) {
    if (isMissingHotelFeatureSchemaError(error)) {
      res.status(503).json(buildFeatureSchemaUnavailablePayload());
      return null;
    }

    throw error;
  }
}

module.exports = {
  requireHotelFeature,
  ensureHotelFeatureEnabled,
  resolveStaffHotelSlug,
  resolveAdminHotelSlug,
  resolvePublicHotelSlug
};
