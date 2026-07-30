const crypto = require("crypto");

const ORDER_TRACKING_COLUMNS = [
  "tracking_token",
  "tracking_token_created_at"
];

function generateOrderTrackingToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getOrderTrackingColumns() {
  return {
    tracking_token: generateOrderTrackingToken(),
    tracking_token_created_at: new Date().toISOString()
  };
}

function buildOrderTrackingReference(order = {}) {
  const orderId = order?.id ? String(order.id) : "";
  const hotelSlug = String(order?.hotel_slug || "").trim();
  const token = String(order?.tracking_token || "").trim();

  if (!orderId || !hotelSlug || !token) {
    return null;
  }

  const params = new URLSearchParams({
    hotel: hotelSlug,
    order: orderId,
    token
  });

  return {
    orderId,
    hotelSlug,
    token,
    path: `order-tracking.html?${params.toString()}`
  };
}

function isMissingOrderTrackingColumnsError(error) {
  if (!error) return false;

  const code = String(error.code || "").trim().toUpperCase();
  const details = [
    error.message,
    error.details,
    error.hint
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    (code === "PGRST204" || details.includes("could not find")) &&
    ORDER_TRACKING_COLUMNS.some((columnName) => details.includes(columnName))
  );
}

module.exports = {
  ORDER_TRACKING_COLUMNS,
  buildOrderTrackingReference,
  generateOrderTrackingToken,
  getOrderTrackingColumns,
  isMissingOrderTrackingColumnsError
};
