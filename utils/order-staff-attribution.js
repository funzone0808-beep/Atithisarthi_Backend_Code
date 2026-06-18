const { normalizeStaffRole, isStaffManagerRole } = require("./auth");

const ORDER_STAFF_ATTRIBUTION_COLUMNS = ["created_by_staff_id"];

function isMissingStaffAccessRelationError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (details.includes("hotel_staff_access") &&
      (details.includes("relation") ||
        details.includes("schema cache") ||
        details.includes("could not find")))
  );
}

function isMissingOrderStaffAttributionColumnsError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "PGRST204" ||
    (
      details.includes("could not find") &&
      ORDER_STAFF_ATTRIBUTION_COLUMNS.some((columnName) => details.includes(columnName))
    )
  );
}

function normalizeOrderCreatedByStaffId(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);
  return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function buildResolvedStaffUserResponse(staffAccess = {}) {
  const role = normalizeStaffRole(staffAccess.role);

  return {
    id: String(staffAccess.id || "").trim(),
    hotelSlug: staffAccess.hotel_slug || "",
    displayName: staffAccess.display_name || "Staff",
    role,
    isManager: isStaffManagerRole(role)
  };
}

async function getOrderCreatedByStaffMap(supabase, orders = []) {
  const staffIds = [...new Set(
    (orders || [])
      .map((order) => normalizeOrderCreatedByStaffId(order?.created_by_staff_id))
      .filter(Boolean)
  )];

  if (!staffIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("hotel_staff_access")
    .select("id,hotel_slug,display_name,role")
    .in("id", staffIds);

  if (error) {
    if (isMissingStaffAccessRelationError(error)) {
      return new Map();
    }

    throw error;
  }

  return new Map(
    (data || []).map((staffAccess) => [
      String(staffAccess.id || "").trim(),
      buildResolvedStaffUserResponse(staffAccess)
    ])
  );
}

function getOrderCreatedByStaffResponse(order = {}, staffById = new Map()) {
  const createdByStaffId = normalizeOrderCreatedByStaffId(order.created_by_staff_id);

  if (!createdByStaffId) {
    return null;
  }

  return (
    staffById.get(String(createdByStaffId)) || {
      id: String(createdByStaffId),
      hotelSlug: order.hotel_slug || "",
      displayName: "",
      role: "",
      isManager: false
    }
  );
}

module.exports = {
  getOrderCreatedByStaffMap,
  getOrderCreatedByStaffResponse,
  isMissingOrderStaffAttributionColumnsError,
  normalizeOrderCreatedByStaffId
};
