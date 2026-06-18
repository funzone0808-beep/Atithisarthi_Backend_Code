const express = require("express");
const bcrypt = require("bcryptjs");
const { supabase } = require("../utils/supabase");
const { createNotificationEventSafely } = require("../utils/notifications");
const {
  buildOrderTrackingReference,
  getOrderTrackingColumns,
  isMissingOrderTrackingColumnsError
} = require("../utils/order-tracking");
const {
  getOrderCreatedByStaffMap,
  getOrderCreatedByStaffResponse,
  isMissingOrderStaffAttributionColumnsError,
  normalizeOrderCreatedByStaffId
} = require("../utils/order-staff-attribution");
const { signStaffToken, normalizeStaffRole, isStaffManagerRole } = require("../utils/auth");
const { requireStaffAuth, requireStaffManagerAccess } = require("../middleware/require-staff-auth");
const { validateBody } = require("../validators/common");
const { staffLoginSchema, staffTableOrderSchema } = require("../validators/staff");

const router = express.Router();
const STAFF_ORDER_RANGES = ["today", "week", "month", "recent", "all"];
const STAFF_ORDERS_DEFAULT_LIMIT = 50;
const STAFF_ORDERS_MAX_LIMIT = 200;
const STAFF_REPORT_BATCH_SIZE = 500;
const STAFF_ITEM_REPORT_LIMIT = 5;
const STAFF_ORDER_STATUSES = ["new", "confirmed", "preparing", "completed", "cancelled"];
const STAFF_RESERVATION_STATUSES = ["new", "confirmed", "seated", "completed", "cancelled"];
const STAFF_INQUIRY_STATUSES = ["new", "contacted", "converted", "closed"];
const STAFF_CONTACT_SUBMISSION_STATUSES = ["new", "contacted", "resolved", "closed", "archived"];
const STAFF_SUPPORT_REQUEST_STATUSES = ["new", "acknowledged", "resolved", "closed"];
const STAFF_MENU_FIELDS = [
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
const ORDER_BILLING_COLUMNS = [
  "payment_status",
  "billing_status",
  "bill_number",
  "billed_at",
  "paid_at"
];
const ORDER_TABLE_CONTEXT_COLUMNS = [
  "order_type",
  "table_number",
  "order_source"
];
const ORDER_ADDON_METADATA_COLUMNS = [
  "parent_order_id",
  "order_group_id",
  "order_entry_type",
  "order_sequence_label",
  "addon_sequence"
];

function getStaffOrderCreatorColumns(staffUser = {}) {
  const createdByStaffId = normalizeOrderCreatedByStaffId(staffUser?.sub || staffUser?.id);
  return createdByStaffId ? { created_by_staff_id: createdByStaffId } : {};
}

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

function isMissingOrderSupportRequestsRelationError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (details.includes("order_support_requests") &&
      (details.includes("relation") ||
        details.includes("schema cache") ||
        details.includes("could not find")))
  );
}

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

function normalizeStatusValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStaffText(value = "", maxLength = 120) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength)
    : "";
}

function getAllowedStaffStatus(value, allowedStatuses = []) {
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

function isMissingOrderBillingColumnsError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "PGRST204" ||
    (
      details.includes("could not find") &&
      ORDER_BILLING_COLUMNS.some((columnName) => details.includes(columnName))
    )
  );
}

function isMissingOrderTableContextColumnsError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "PGRST204" ||
    (
      details.includes("could not find") &&
      ORDER_TABLE_CONTEXT_COLUMNS.some((columnName) => details.includes(columnName))
    )
  );
}

function isMissingOrderAddonMetadataColumnsError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`
    .trim()
    .toLowerCase();

  return (
    code === "PGRST204" ||
    (
      details.includes("could not find") &&
      ORDER_ADDON_METADATA_COLUMNS.some((columnName) => details.includes(columnName))
    )
  );
}

async function fetchStaffOrderFamily({ hotelSlug, orderId }) {
  const { data: parentOrder, error: parentOrderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("hotel_slug", hotelSlug)
    .maybeSingle();

  if (parentOrderError) throw parentOrderError;

  if (!parentOrder) {
    return {
      parentOrder: null,
      familyOrders: []
    };
  }

  if (parentOrder.parent_order_id) {
    return {
      parentOrder,
      familyOrders: []
    };
  }

  const { data: childOrders, error: childOrdersError } = await supabase
    .from("orders")
    .select("*")
    .eq("hotel_slug", hotelSlug)
    .eq("parent_order_id", String(orderId))
    .order("addon_sequence", { ascending: true })
    .order("created_at", { ascending: true });

  if (childOrdersError) throw childOrdersError;

  return {
    parentOrder,
    familyOrders: [parentOrder, ...(childOrders || [])]
  };
}

async function updateStaffOrderFamilyRecords({ familyOrders, buildUpdatePayload }) {
  const updatedOrders = [];

  for (const order of familyOrders) {
    const { data, error } = await supabase
      .from("orders")
      .update(buildUpdatePayload(order))
      .eq("id", order.id)
      .eq("hotel_slug", order.hotel_slug)
      .select()
      .single();

    if (error) throw error;
    updatedOrders.push(data);
  }

  return updatedOrders;
}

function getSafeJsonRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function buildStaffRouteTransferResponse(order = {}) {
  const paymentMetadata = getSafeJsonRecord(order.payment_metadata);
  const routeMetadata = getSafeJsonRecord(paymentMetadata.route);
  const transferStatus =
    order.gateway_transfer_status ||
    routeMetadata.transferStatus ||
    routeMetadata.transfer_status ||
    "";
  const settlementStatus =
    order.gateway_settlement_status ||
    routeMetadata.settlementStatus ||
    routeMetadata.settlement_status ||
    "";
  const transferId =
    order.gateway_transfer_id ||
    routeMetadata.transferId ||
    routeMetadata.transfer_id ||
    "";
  const transferError =
    order.gateway_transfer_error ||
    routeMetadata.transferError ||
    routeMetadata.transfer_error ||
    "";

  return {
    transferId,
    transferStatus,
    settlementStatus,
    transferError,
    transferRequested:
      !!routeMetadata.transferRequested ||
      !!routeMetadata.transferId ||
      !!transferId ||
      !!transferStatus,
    routeStatus: routeMetadata.routeStatus || "",
    routeReady: !!routeMetadata.routeReady
  };
}

function buildStaffUserResponse(staffAccess) {
  const role = normalizeStaffRole(staffAccess.role);

  return {
    id: staffAccess.id,
    hotelSlug: staffAccess.hotel_slug,
    displayName: staffAccess.display_name || "Staff",
    role,
    isManager: isStaffManagerRole(role)
  };
}

function buildStaffSessionResponse(staffUser = {}) {
  const role = normalizeStaffRole(staffUser.role);

  return {
    id: staffUser.sub || staffUser.id || "",
    hotelSlug: staffUser.hotelSlug || staffUser.hotel_slug || "",
    displayName: staffUser.displayName || staffUser.display_name || "Staff",
    role,
    isManager: isStaffManagerRole(role)
  };
}

async function getStaffOrderHotelContext(hotelSlug) {
  const normalizedHotelSlug = normalizeStaffText(hotelSlug, 120);

  if (!normalizedHotelSlug) {
    return {
      error: "Staff hotel scope is missing"
    };
  }

  const { data, error } = await supabase
    .from("hotel_profiles")
    .select("hotel_slug,hotel_name,gst_percent")
    .eq("hotel_slug", normalizedHotelSlug)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      error: "Hotel profile not found"
    };
  }

  return { hotel: data };
}

async function getStaffAvailableMenuItemsById(hotelSlug, itemIds = []) {
  const { data, error } = await supabase
    .from("menu_items")
    .select("item_id,name,price")
    .eq("hotel_slug", hotelSlug)
    .eq("is_available", true)
    .eq("is_archived", false)
    .in("item_id", itemIds);

  if (error) throw error;

  return new Map((data || []).map((item) => [String(item.item_id), item]));
}

async function calculateStaffTableOrderPricing({ hotelSlug, items }) {
  const hotelContext = await getStaffOrderHotelContext(hotelSlug);

  if (hotelContext.error) {
    return hotelContext;
  }

  const hotel = hotelContext.hotel;
  const uniqueItemIds = [...new Set((items || []).map((item) => String(item.id || "")))].filter(Boolean);
  const menuItemsById = await getStaffAvailableMenuItemsById(hotel.hotel_slug, uniqueItemIds);
  const missingItems = uniqueItemIds.filter((itemId) => !menuItemsById.has(itemId));

  if (missingItems.length) {
    return {
      error: `Some menu items are unavailable: ${missingItems.join(", ")}`
    };
  }

  const verifiedItems = (items || []).map((item) => {
    const itemId = String(item.id || "");
    const menuItem = menuItemsById.get(itemId);
    const qty = Number(item.qty || 0);
    const price = Number(menuItem.price || 0);

    return {
      id: itemId,
      name: menuItem.name || itemId,
      qty,
      price,
      lineTotal: price * qty
    };
  });
  const subtotal = verifiedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const gstPercent = Number(hotel.gst_percent || 5);
  const gst = Math.round((subtotal * gstPercent) / 100);
  const normalTotal = subtotal + gst;

  return {
    hotel,
    items: verifiedItems,
    totals: {
      subtotal,
      gst,
      deliveryCharge: 0,
      gstPercent,
      normalTotal,
      total: normalTotal
    }
  };
}

function formatStaffOrderMoney(amount = 0) {
  return `Rs. ${Number(amount || 0).toFixed(2)}`;
}

function buildStaffTableOrderSummary({
  hotelName,
  tableNumber,
  staffUser,
  customerName,
  customerPhone,
  note,
  items,
  totals
}) {
  const lines = [
    `Staff Table Order - ${hotelName || "Hotel"}`,
    "----------------------",
    "Order Type: Dine-in",
    `Table: ${tableNumber}`,
    "Source: Staff",
    `Taken By: ${staffUser?.displayName || staffUser?.display_name || "Staff"}`
  ];

  if (customerName) {
    lines.push(`Guest: ${customerName}`);
  }

  if (customerPhone) {
    lines.push(`Phone: ${customerPhone}`);
  }

  lines.push("");
  (items || []).forEach((item) => {
    lines.push(`${item.name} x${item.qty} = ${formatStaffOrderMoney(item.price * item.qty)}`);
  });
  lines.push("");
  lines.push(`Subtotal = ${formatStaffOrderMoney(totals.subtotal)}`);
  lines.push(`GST = ${formatStaffOrderMoney(totals.gst)}`);
  lines.push(`Total = ${formatStaffOrderMoney(totals.normalTotal)}`);
  lines.push("Payment Status = Unpaid");
  lines.push("Billing Status = Not billed");

  if (note) {
    lines.push("");
    lines.push(`Note = ${note}`);
  }

  return lines.join("\n");
}

async function insertStaffTableOrderRow(baseOrderRow, optionalOrderColumns) {
  let currentOptionalOrderColumns = { ...optionalOrderColumns };
  let insertAttempt = await supabase
    .from("orders")
    .insert([{ ...baseOrderRow, ...currentOptionalOrderColumns }])
    .select()
    .single();

  if (insertAttempt.error && isMissingOrderTrackingColumnsError(insertAttempt.error)) {
    const { tracking_token, tracking_token_created_at, ...columnsWithoutTracking } =
      currentOptionalOrderColumns;
    currentOptionalOrderColumns = columnsWithoutTracking;
    insertAttempt = await supabase
      .from("orders")
      .insert([{ ...baseOrderRow, ...currentOptionalOrderColumns }])
      .select()
      .single();
  }

  if (
    insertAttempt.error &&
    isMissingOrderStaffAttributionColumnsError(insertAttempt.error)
  ) {
    const { created_by_staff_id, ...columnsWithoutStaffAttribution } =
      currentOptionalOrderColumns;
    currentOptionalOrderColumns = columnsWithoutStaffAttribution;
    insertAttempt = await supabase
      .from("orders")
      .insert([{ ...baseOrderRow, ...currentOptionalOrderColumns }])
      .select()
      .single();
  }

  return insertAttempt;
}

function getStaffOrdersRange(value = "") {
  const normalizedRange = String(value || "").trim().toLowerCase();
  return STAFF_ORDER_RANGES.includes(normalizedRange) ? normalizedRange : "recent";
}

function getStaffOrdersLimit(value, range = "recent") {
  const parsedLimit = Number.parseInt(String(value || "").trim(), 10);
  const defaultLimit = range === "all" ? STAFF_ORDERS_MAX_LIMIT : STAFF_ORDERS_DEFAULT_LIMIT;

  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return defaultLimit;
  }

  return Math.min(parsedLimit, STAFF_ORDERS_MAX_LIMIT);
}

function getStaffOrdersRangeStart(range) {
  const now = new Date();

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (range === "week") {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    return weekStart;
  }

  if (range === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return null;
}

function getStaffNumberValue(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function getStaffOrderItemsSubtotal(order = {}) {
  return Array.isArray(order.items)
    ? order.items.reduce((sum, item) => {
      const quantity = getStaffNumberValue(item?.qty) || 0;
      const price = getStaffNumberValue(item?.price) || 0;
      return sum + quantity * price;
    }, 0)
    : 0;
}

function getStaffOrderTotalAmount(order = {}) {
  const totals =
    order.totals && typeof order.totals === "object" && !Array.isArray(order.totals)
      ? order.totals
      : {};

  return (
    getStaffNumberValue(totals.gpayFinalTotal) ??
    getStaffNumberValue(totals.final) ??
    getStaffNumberValue(totals.total) ??
    getStaffNumberValue(totals.normalTotal) ??
    getStaffOrderItemsSubtotal(order)
  );
}

function getStaffOrderReportSourceKey(order = {}) {
  const source = normalizeStatusValue(order.order_source);
  const orderType = normalizeStatusValue(order.order_type);
  const tableNumber = String(order.table_number || "").trim();
  const isQrTableOrder =
    Boolean(tableNumber) ||
    orderType === "dine-in" ||
    source === "qr" ||
    source === "table" ||
    source === "dine-in";

  return isQrTableOrder ? "qr-table" : "website";
}

function createStaffOrdersSummary() {
  return {
    totalOrders: 0,
    totalEarnings: 0,
    paidOrders: 0,
    unpaidOrders: 0,
    paidEarnings: 0,
    unpaidEarnings: 0,
    billedOrders: 0,
    unbilledOrders: 0,
    qrOrders: 0,
    websiteOrders: 0,
    qrEarnings: 0,
    websiteEarnings: 0
  };
}

function addStaffOrderToSummary(summary, order = {}) {
  const total = getStaffOrderTotalAmount(order);
  const paymentStatus = normalizeStatusValue(order.payment_status);
  const billingStatus = normalizeStatusValue(order.billing_status);
  const sourceKey = getStaffOrderReportSourceKey(order);

  summary.totalOrders += 1;
  summary.totalEarnings += total;

  if (paymentStatus === "paid") {
    summary.paidOrders += 1;
    summary.paidEarnings += total;
  } else {
    summary.unpaidOrders += 1;
    summary.unpaidEarnings += total;
  }

  if (billingStatus === "billed") {
    summary.billedOrders += 1;
  } else {
    summary.unbilledOrders += 1;
  }

  if (sourceKey === "qr-table") {
    summary.qrOrders += 1;
    summary.qrEarnings += total;
  } else {
    summary.websiteOrders += 1;
    summary.websiteEarnings += total;
  }

  return summary;
}

function getStaffOperationalReportStarts(now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    todayStart,
    weekStart,
    monthStart,
    earliestStart: weekStart < monthStart ? weekStart : monthStart
  };
}

async function fetchStaffOrdersForReports({ hotelSlug, startDate }) {
  const orders = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("orders")
      .select("id, order_type, table_number, order_source, payment_status, billing_status, items, totals, created_at")
      .eq("hotel_slug", hotelSlug)
      .order("created_at", { ascending: false })
      .range(from, from + STAFF_REPORT_BATCH_SIZE - 1);

    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }

    const { data, error } = await query;

    if (error) throw error;

    const batch = Array.isArray(data) ? data : [];
    orders.push(...batch);

    if (batch.length < STAFF_REPORT_BATCH_SIZE) {
      break;
    }

    from += STAFF_REPORT_BATCH_SIZE;
  }

  return orders;
}

function buildStaffOperationalReports(orders = [], starts = getStaffOperationalReportStarts()) {
  const reports = {
    today: createStaffOrdersSummary(),
    week: createStaffOrdersSummary(),
    month: createStaffOrdersSummary()
  };

  orders.forEach((order) => {
    const createdAtValue = order?.created_at ? new Date(order.created_at) : null;
    if (!createdAtValue || Number.isNaN(createdAtValue.getTime())) return;

    if (createdAtValue >= starts.todayStart) {
      addStaffOrderToSummary(reports.today, order);
    }

    if (createdAtValue >= starts.weekStart) {
      addStaffOrderToSummary(reports.week, order);
    }

    if (createdAtValue >= starts.monthStart) {
      addStaffOrderToSummary(reports.month, order);
    }
  });

  return reports;
}

function normalizeStaffItemId(item = {}) {
  return String(item?.id || item?.itemId || item?.item_id || "")
    .trim()
    .slice(0, 120);
}

function normalizeStaffItemName(item = {}, fallback = "Unnamed item") {
  const name = String(item?.name || item?.itemName || item?.item_name || "")
    .trim()
    .slice(0, 160);

  return name || fallback;
}

function getStaffItemQuantity(item = {}) {
  const quantity =
    getStaffNumberValue(item?.qty) ??
    getStaffNumberValue(item?.quantity) ??
    0;

  return quantity > 0 ? quantity : 0;
}

function getStaffItemRevenue(item = {}) {
  const explicitLineTotal = getStaffNumberValue(item?.lineTotal);

  if (explicitLineTotal !== null && explicitLineTotal >= 0) {
    return explicitLineTotal;
  }

  const quantity = getStaffItemQuantity(item);
  const price = getStaffNumberValue(item?.price) || 0;
  return quantity * price;
}

function createStaffItemSalesSummary() {
  return {
    totalDistinctItems: 0,
    totalUnitsSold: 0,
    totalRevenue: 0,
    topItems: [],
    lowItems: []
  };
}

function addStaffOrderItemsToSalesMap(itemsMap, order = {}) {
  if (!(itemsMap instanceof Map) || !Array.isArray(order.items)) {
    return itemsMap;
  }

  const orderId = String(order.id || "").trim();
  const createdAt = String(order.created_at || "").trim();
  const sourceKey = getStaffOrderReportSourceKey(order);

  order.items.forEach((item) => {
    const itemId = normalizeStaffItemId(item);
    const itemName = normalizeStaffItemName(item, itemId || "Unnamed item");
    const quantity = getStaffItemQuantity(item);
    const revenue = getStaffItemRevenue(item);

    if (!itemId || !itemName || quantity <= 0) {
      return;
    }

    const existing = itemsMap.get(itemId) || {
      itemId,
      itemName,
      quantitySold: 0,
      revenue: 0,
      orderCount: 0,
      qrOrders: 0,
      websiteOrders: 0,
      qrRevenue: 0,
      websiteRevenue: 0,
      lastOrderedAt: "",
      orderIds: new Set()
    };

    existing.quantitySold += quantity;
    existing.revenue += revenue;

    if (sourceKey === "qr-table") {
      existing.qrOrders += 1;
      existing.qrRevenue += revenue;
    } else {
      existing.websiteOrders += 1;
      existing.websiteRevenue += revenue;
    }

    if (orderId && !existing.orderIds.has(orderId)) {
      existing.orderIds.add(orderId);
      existing.orderCount += 1;
    }

    if (createdAt && (!existing.lastOrderedAt || createdAt > existing.lastOrderedAt)) {
      existing.lastOrderedAt = createdAt;
    }

    itemsMap.set(itemId, existing);
  });

  return itemsMap;
}

function finalizeStaffItemSalesEntries(itemsMap) {
  if (!(itemsMap instanceof Map)) {
    return [];
  }

  return [...itemsMap.values()]
    .map((entry) => ({
      itemId: entry.itemId,
      itemName: entry.itemName,
      quantitySold: entry.quantitySold,
      revenue: entry.revenue,
      orderCount: entry.orderCount,
      qrOrders: entry.qrOrders,
      websiteOrders: entry.websiteOrders,
      qrRevenue: entry.qrRevenue,
      websiteRevenue: entry.websiteRevenue,
      lastOrderedAt: entry.lastOrderedAt || ""
    }))
    .filter((entry) => entry.itemId && entry.quantitySold > 0);
}

function sortStaffTopSellingItems(entries = []) {
  return [...entries].sort((left, right) => (
    right.quantitySold - left.quantitySold ||
    right.revenue - left.revenue ||
    right.orderCount - left.orderCount ||
    left.itemName.localeCompare(right.itemName)
  ));
}

function sortStaffLowSellingItems(entries = []) {
  return [...entries].sort((left, right) => (
    left.quantitySold - right.quantitySold ||
    left.revenue - right.revenue ||
    left.orderCount - right.orderCount ||
    left.itemName.localeCompare(right.itemName)
  ));
}

function buildStaffItemSalesSummary(orders = []) {
  const itemsMap = new Map();

  orders.forEach((order) => {
    addStaffOrderItemsToSalesMap(itemsMap, order);
  });

  const entries = finalizeStaffItemSalesEntries(itemsMap);
  const topItems = sortStaffTopSellingItems(entries).slice(0, STAFF_ITEM_REPORT_LIMIT);
  const lowItems = sortStaffLowSellingItems(entries).slice(0, STAFF_ITEM_REPORT_LIMIT);

  return {
    totalDistinctItems: entries.length,
    totalUnitsSold: entries.reduce((sum, entry) => sum + entry.quantitySold, 0),
    totalRevenue: entries.reduce((sum, entry) => sum + entry.revenue, 0),
    topItems,
    lowItems
  };
}

function buildStaffItemSalesReports(orders = [], starts = getStaffOperationalReportStarts()) {
  const periods = {
    today: [],
    week: [],
    month: []
  };

  orders.forEach((order) => {
    const createdAtValue = order?.created_at ? new Date(order.created_at) : null;
    if (!createdAtValue || Number.isNaN(createdAtValue.getTime())) return;

    if (createdAtValue >= starts.todayStart) {
      periods.today.push(order);
    }

    if (createdAtValue >= starts.weekStart) {
      periods.week.push(order);
    }

    if (createdAtValue >= starts.monthStart) {
      periods.month.push(order);
    }
  });

  return {
    today: buildStaffItemSalesSummary(periods.today),
    week: buildStaffItemSalesSummary(periods.week),
    month: buildStaffItemSalesSummary(periods.month),
    basis: {
      reportLimit: STAFF_ITEM_REPORT_LIMIT,
      lowItemsMeaning:
        "Low-selling items are ranked only among items that were sold in the selected report window."
    }
  };
}

function buildStaffOrderResponse(order = {}, staffById = new Map()) {
  const createdByStaffId = normalizeOrderCreatedByStaffId(order.created_by_staff_id);

  return {
    id: order.id,
    hotelSlug: order.hotel_slug || "",
    hotelName: order.hotel_name || "",
    orderType: order.order_type || "",
    tableNumber: order.table_number || "",
    orderSource: order.order_source || "",
    parentOrderId: order.parent_order_id ? String(order.parent_order_id) : "",
    orderGroupId: order.order_group_id || "",
    orderEntryType: order.order_entry_type || "",
    orderSequenceLabel: order.order_sequence_label || "",
    addonSequence: order.addon_sequence || null,
    customerName: order.customer_name || "",
    customerPhone: order.customer_phone || "",
    customerAddress: order.customer_address || "",
    paymentMethod: order.payment_method || "",
    paymentStatus: order.payment_status || "",
    billingStatus: order.billing_status || "",
    billNumber: order.bill_number || "",
    billedAt: order.billed_at || "",
    paidAt: order.paid_at || "",
    status: order.status || "new",
    note: order.note || "",
    items: Array.isArray(order.items) ? order.items : [],
    totals:
      order.totals && typeof order.totals === "object" && !Array.isArray(order.totals)
        ? order.totals
        : {},
    routeTransfer: buildStaffRouteTransferResponse(order),
    createdAt: order.created_at || "",
    createdByStaffId: createdByStaffId ? String(createdByStaffId) : "",
    createdByStaff: getOrderCreatedByStaffResponse(order, staffById)
  };
}

function buildStaffMenuItemResponse(item = {}) {
  return {
    id: item.item_id || "",
    name: item.name || "",
    desc: item.description || "",
    price: Number(item.price || 0),
    image: item.image || "",
    alt: item.alt || item.name || "",
    badge: item.badge || "",
    tag: item.tag || "",
    category: item.category || "others",
    sortOrder: Number(item.sort_order || 0)
  };
}

function groupStaffMenuItemsByCategory(items = []) {
  return items.reduce((groupedMenu, item) => {
    const category = item.category || "others";

    if (!groupedMenu[category]) {
      groupedMenu[category] = [];
    }

    groupedMenu[category].push(item);
    return groupedMenu;
  }, {});
}

function buildStaffReservationResponse(reservation = {}) {
  return {
    id: reservation.id,
    hotelSlug: reservation.hotel_slug || "",
    hotelName: reservation.hotel_name || "",
    name: reservation.name || "",
    phone: reservation.phone || "",
    date: reservation.date || "",
    time: reservation.time || "",
    guests: reservation.guests || "",
    note: reservation.note || "",
    status: reservation.status || "new",
    createdAt: reservation.created_at || ""
  };
}

function buildStaffInquiryResponse(inquiry = {}) {
  return {
    id: inquiry.id,
    hotelSlug: inquiry.hotel_slug || "",
    hotelName: inquiry.hotel_name || "",
    name: inquiry.name || "",
    phone: inquiry.phone || "",
    eventType: inquiry.event_type || "",
    date: inquiry.date || "",
    guests: inquiry.guests || "",
    specialRequirements: inquiry.special_requirements || "",
    status: inquiry.status || "new",
    createdAt: inquiry.created_at || ""
  };
}

function buildStaffContactSubmissionResponse(contactSubmission = {}) {
  return {
    id: contactSubmission.id,
    hotelSlug: contactSubmission.hotel_slug || "",
    hotelName: contactSubmission.hotel_name || "",
    name: contactSubmission.name || "",
    email: contactSubmission.email || "",
    subject: contactSubmission.subject || "",
    message: contactSubmission.message || "",
    status: contactSubmission.status || "new",
    source: contactSubmission.source || "",
    googleSheetStatus: contactSubmission.google_sheet_status || "",
    createdAt: contactSubmission.created_at || ""
  };
}

function buildStaffSupportRequestResponse(supportRequest = {}) {
  return {
    id: supportRequest.id,
    hotelSlug: supportRequest.hotel_slug || "",
    hotelName: supportRequest.hotel_name || "",
    orderId: String(supportRequest.order_id || ""),
    tableNumber: supportRequest.table_number || "",
    requestType: supportRequest.request_type || "",
    status: supportRequest.status || "new",
    orderStatus: supportRequest.order_status || "",
    message: supportRequest.message || "",
    source: supportRequest.source || "",
    createdAt: supportRequest.created_at || "",
    updatedAt: supportRequest.updated_at || ""
  };
}

function buildStaffTestimonialResponse(testimonial = {}) {
  return {
    id: testimonial.id,
    hotelSlug: testimonial.hotel_slug || "",
    name: testimonial.guest_name || "",
    role: testimonial.guest_role || "",
    text: testimonial.review_text || "",
    stars: Number(testimonial.star_rating || 5),
    avatar: testimonial.avatar_url || "",
    sortOrder: Number(testimonial.sort_order || 0),
    isActive: testimonial.is_active !== false,
    isApproved: testimonial.is_approved !== false,
    isArchived: testimonial.is_archived === true,
    createdAt: testimonial.created_at || "",
    updatedAt: testimonial.updated_at || ""
  };
}

async function updateStaffScopedRecordStatus(req, res, config = {}) {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();
    const recordId = String(req.params.id || "").trim();
    const status = getAllowedStaffStatus(req.body?.status, config.allowedStatuses);

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    if (!recordId) {
      return res.status(400).json({
        success: false,
        message: `${config.label} id is required`
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${config.allowedStatuses.join(", ")}`
      });
    }

    const { data, error } = await supabase
      .from(config.table)
      .update({ status })
      .eq("id", recordId)
      .eq("hotel_slug", hotelSlug)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `${config.label} not found for this hotel`
      });
    }

    res.json({
      success: true,
      message: `${config.label} status updated`,
      [config.responseKey]: config.buildResponse(data)
    });
  } catch (error) {
    if (
      typeof config.isMissingRelationError === "function" &&
      config.isMissingRelationError(error)
    ) {
      return res.status(400).json({
        success: false,
        message: config.missingRelationMessage || `${config.label} table is not initialized yet`
      });
    }

    console.error(`Staff ${config.responseKey} status update error:`, error);
    res.status(500).json({
      success: false,
      message: `Failed to update ${config.label.toLowerCase()} status`
    });
  }
}

router.post("/login", validateBody(staffLoginSchema), async (req, res) => {
  try {
    const { hotelSlug, pin } = req.validatedBody;
    const normalizedHotelSlug = String(hotelSlug || "").trim();

    const { data: staffAccessRows, error } = await supabase
      .from("hotel_staff_access")
      .select("id,hotel_slug,display_name,role,pin_hash,is_active")
      .eq("hotel_slug", normalizedHotelSlug)
      .eq("is_active", true);

    if (error) {
      if (isMissingStaffAccessRelationError(error)) {
        return res.status(503).json({
          success: false,
          message: "Staff access is not initialized yet"
        });
      }

      throw error;
    }

    const activeAccessRows = Array.isArray(staffAccessRows) ? staffAccessRows : [];
    let matchedStaffAccess = null;

    for (const staffAccess of activeAccessRows) {
      const isMatch = await bcrypt.compare(pin, staffAccess.pin_hash || "");

      if (isMatch) {
        matchedStaffAccess = staffAccess;
        break;
      }
    }

    if (!matchedStaffAccess) {
      return res.status(401).json({
        success: false,
        message: "Invalid hotel slug or PIN"
      });
    }

    await supabase
      .from("hotel_staff_access")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", matchedStaffAccess.id);

    const token = signStaffToken(matchedStaffAccess);

    res.json({
      success: true,
      message: "Staff login successful",
      token,
      staffUser: buildStaffUserResponse(matchedStaffAccess)
    });
  } catch (error) {
    console.error("Staff login error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to login staff user"
    });
  }
});

router.get("/menu", requireStaffAuth, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const { data, error } = await supabase
      .from("menu_items")
      .select(STAFF_MENU_FIELDS)
      .eq("hotel_slug", hotelSlug)
      .eq("is_available", true)
      .eq("is_archived", false)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const items = (data || []).map(buildStaffMenuItemResponse);

    res.json({
      success: true,
      hotelSlug,
      count: items.length,
      items,
      menu: groupStaffMenuItemsByCategory(items)
    });
  } catch (error) {
    console.error("Staff menu fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff menu"
    });
  }
});

router.get("/orders", requireStaffAuth, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const range = getStaffOrdersRange(req.query.range);
    const limit = getStaffOrdersLimit(req.query.limit, range);
    const rangeStart = getStaffOrdersRangeStart(range);
    let query = supabase
      .from("orders")
      .select("*")
      .eq("hotel_slug", hotelSlug)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rangeStart) {
      query = query.gte("created_at", rangeStart.toISOString());
    }

    const { data, error } = await query;

    if (error) throw error;

    const safeOrders = data || [];
    const staffById = await getOrderCreatedByStaffMap(supabase, safeOrders);
    const orders = safeOrders.map((order) => buildStaffOrderResponse(order, staffById));

    res.json({
      success: true,
      hotelSlug,
      range,
      count: orders.length,
      orders
    });
  } catch (error) {
    console.error("Staff orders fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff orders"
    });
  }
});

router.post("/orders", requireStaffAuth, validateBody(staffTableOrderSchema), async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const tableNumber = normalizeStaffText(req.validatedBody.tableNumber, 80);
    const customerName = normalizeStaffText(req.validatedBody.customerName, 100) || "Table Guest";
    const customerPhone = normalizeStaffText(req.validatedBody.customerPhone, 20);
    const note = normalizeStaffText(req.validatedBody.note, 1000);
    const items = req.validatedBody.items || [];
    const pricing = await calculateStaffTableOrderPricing({ hotelSlug, items });

    if (pricing.error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        details: [
          {
            path: ["items"],
            message: pricing.error
          }
        ]
      });
    }

    const hotelName = pricing.hotel.hotel_name || "Unknown Hotel";
    const orderSummary = buildStaffTableOrderSummary({
      hotelName,
      tableNumber,
      staffUser: req.staffUser,
      customerName,
      customerPhone,
      note,
      items: pricing.items,
      totals: pricing.totals
    });
    const baseOrderRow = {
      hotel_name: hotelName,
      hotel_slug: pricing.hotel.hotel_slug || hotelSlug,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: `Dine-in table ${tableNumber}`,
      payment_method: "COD",
      note,
      items: pricing.items,
      totals: pricing.totals,
      whatsapp_message: orderSummary,
      status: "new"
    };
    const optionalOrderColumns = {
      order_type: "dine-in",
      table_number: tableNumber,
      order_source: "staff",
      payment_status: "unpaid",
      billing_status: "not_billed",
      ...getStaffOrderCreatorColumns(req.staffUser),
      ...getOrderTrackingColumns()
    };
    const { data, error } = await insertStaffTableOrderRow(
      baseOrderRow,
      optionalOrderColumns
    );

    if (error) {
      if (isMissingOrderTableContextColumnsError(error)) {
        return res.status(400).json({
          success: false,
          message: "Order table context fields are not initialized yet"
        });
      }

      if (isMissingOrderBillingColumnsError(error)) {
        return res.status(400).json({
          success: false,
          message: "Order billing fields are not initialized yet"
        });
      }

      throw error;
    }

    void createNotificationEventSafely({
      hotelSlug: data.hotel_slug || hotelSlug,
      sourceType: "order",
      sourceId: data.id,
      payload: {
        orderId: data.id,
        hotelName: data.hotel_name || hotelName,
        customerName: data.customer_name || customerName,
        customerPhone: data.customer_phone || customerPhone,
        customerAddress: data.customer_address || `Dine-in table ${tableNumber}`,
        paymentMethod: data.payment_method || "COD",
        paymentStatus: data.payment_status || "unpaid",
        billingStatus: data.billing_status || "not_billed",
        note: data.note || note,
        items: Array.isArray(data.items) ? data.items : pricing.items,
        totals:
          data.totals && typeof data.totals === "object" && !Array.isArray(data.totals)
            ? data.totals
            : pricing.totals,
        whatsappMessage: data.whatsapp_message || orderSummary,
        orderContext: {
          orderType: data.order_type || "dine-in",
          tableNumber: data.table_number || tableNumber,
          orderSource: data.order_source || "staff"
        },
        status: data.status || "new",
        createdByStaff: {
          id: req.staffUser?.sub || req.staffUser?.id || "",
          displayName: req.staffUser?.displayName || "Staff",
          role: req.staffUser?.role || "staff"
        }
      }
    });

    const tracking = buildOrderTrackingReference(data);
    const createdByStaffMap = await getOrderCreatedByStaffMap(supabase, [data]);

    res.status(201).json({
      success: true,
      message: "Staff table order saved",
      order: buildStaffOrderResponse(
        data,
        createdByStaffMap
      ),
      tracking,
      trackingReady: !!tracking
    });
  } catch (error) {
    console.error("Staff table order create error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create staff table order"
    });
  }
});

router.get("/orders-reports", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const reportStarts = getStaffOperationalReportStarts();
    const orders = await fetchStaffOrdersForReports({
      hotelSlug,
      startDate: reportStarts.earliestStart
    });

    res.json({
      success: true,
      hotelSlug,
      reports: buildStaffOperationalReports(orders, reportStarts)
    });
  } catch (error) {
    console.error("Staff order reports fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff order reports"
    });
  }
});

router.get("/orders-item-sales-reports", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const reportStarts = getStaffOperationalReportStarts();
    const orders = await fetchStaffOrdersForReports({
      hotelSlug,
      startDate: reportStarts.earliestStart
    });

    res.json({
      success: true,
      hotelSlug,
      itemSalesReports: buildStaffItemSalesReports(orders, reportStarts)
    });
  } catch (error) {
    console.error("Staff item sales reports fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff item sales reports"
    });
  }
});

router.get("/reservations", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const range = getStaffOrdersRange(req.query.range);
    const limit = getStaffOrdersLimit(req.query.limit, range);
    const rangeStart = getStaffOrdersRangeStart(range);
    let query = supabase
      .from("reservations")
      .select("*")
      .eq("hotel_slug", hotelSlug)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rangeStart) {
      query = query.gte("created_at", rangeStart.toISOString());
    }

    const { data, error } = await query;

    if (error) throw error;

    const reservations = (data || []).map(buildStaffReservationResponse);

    res.json({
      success: true,
      hotelSlug,
      range,
      count: reservations.length,
      reservations
    });
  } catch (error) {
    console.error("Staff reservations fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff reservations"
    });
  }
});

router.get("/inquiries", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const range = getStaffOrdersRange(req.query.range);
    const limit = getStaffOrdersLimit(req.query.limit, range);
    const rangeStart = getStaffOrdersRangeStart(range);
    let query = supabase
      .from("inquiries")
      .select("*")
      .eq("hotel_slug", hotelSlug)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rangeStart) {
      query = query.gte("created_at", rangeStart.toISOString());
    }

    const { data, error } = await query;

    if (error) throw error;

    const inquiries = (data || []).map(buildStaffInquiryResponse);

    res.json({
      success: true,
      hotelSlug,
      range,
      count: inquiries.length,
      inquiries
    });
  } catch (error) {
    console.error("Staff inquiries fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff inquiries"
    });
  }
});

router.get("/contact-submissions", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const range = getStaffOrdersRange(req.query.range);
    const limit = getStaffOrdersLimit(req.query.limit, range);
    const rangeStart = getStaffOrdersRangeStart(range);
    let query = supabase
      .from("contact_submissions")
      .select("*")
      .eq("hotel_slug", hotelSlug)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rangeStart) {
      query = query.gte("created_at", rangeStart.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingContactSubmissionsRelationError(error)) {
        return res.json({
          success: true,
          hotelSlug,
          range,
          count: 0,
          contactSubmissions: []
        });
      }

      throw error;
    }

    const contactSubmissions = (data || []).map(buildStaffContactSubmissionResponse);

    res.json({
      success: true,
      hotelSlug,
      range,
      count: contactSubmissions.length,
      contactSubmissions
    });
  } catch (error) {
    console.error("Staff contact submissions fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff contact submissions"
    });
  }
});

router.get("/support-requests", requireStaffAuth, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const range = getStaffOrdersRange(req.query.range);
    const limit = getStaffOrdersLimit(req.query.limit, range);
    const rangeStart = getStaffOrdersRangeStart(range);
    let query = supabase
      .from("order_support_requests")
      .select("*")
      .eq("hotel_slug", hotelSlug)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rangeStart) {
      query = query.gte("created_at", rangeStart.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingOrderSupportRequestsRelationError(error)) {
        return res.json({
          success: true,
          hotelSlug,
          range,
          count: 0,
          supportRequests: []
        });
      }

      throw error;
    }

    const supportRequests = (data || []).map(buildStaffSupportRequestResponse);

    res.json({
      success: true,
      hotelSlug,
      range,
      count: supportRequests.length,
      supportRequests
    });
  } catch (error) {
    console.error("Staff support requests fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff support requests"
    });
  }
});

router.get("/testimonials", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    const range = getStaffOrdersRange(req.query.range);
    const limit = getStaffOrdersLimit(req.query.limit, range);
    const rangeStart = getStaffOrdersRangeStart(range);
    let query = supabase
      .from("testimonials")
      .select("*")
      .eq("hotel_slug", hotelSlug)
      .order("is_approved", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rangeStart) {
      query = query.gte("created_at", rangeStart.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.json({
          success: true,
          hotelSlug,
          range,
          count: 0,
          testimonials: []
        });
      }

      throw error;
    }

    const testimonials = (data || []).map(buildStaffTestimonialResponse);

    res.json({
      success: true,
      hotelSlug,
      range,
      count: testimonials.length,
      testimonials
    });
  } catch (error) {
    console.error("Staff testimonials fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch staff testimonials"
    });
  }
});

router.patch("/reservations/:id/status", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  await updateStaffScopedRecordStatus(req, res, {
    table: "reservations",
    label: "Reservation",
    responseKey: "reservation",
    allowedStatuses: STAFF_RESERVATION_STATUSES,
    buildResponse: buildStaffReservationResponse
  });
});

router.patch("/inquiries/:id/status", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  await updateStaffScopedRecordStatus(req, res, {
    table: "inquiries",
    label: "Inquiry",
    responseKey: "inquiry",
    allowedStatuses: STAFF_INQUIRY_STATUSES,
    buildResponse: buildStaffInquiryResponse
  });
});

router.patch("/contact-submissions/:id/status", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  await updateStaffScopedRecordStatus(req, res, {
    table: "contact_submissions",
    label: "Contact message",
    responseKey: "contactSubmission",
    allowedStatuses: STAFF_CONTACT_SUBMISSION_STATUSES,
    buildResponse: buildStaffContactSubmissionResponse,
    isMissingRelationError: isMissingContactSubmissionsRelationError,
    missingRelationMessage: "Contact submissions table is not initialized yet"
  });
});

router.patch("/support-requests/:id/status", requireStaffAuth, async (req, res) => {
  await updateStaffScopedRecordStatus(req, res, {
    table: "order_support_requests",
    label: "Support request",
    responseKey: "supportRequest",
    allowedStatuses: STAFF_SUPPORT_REQUEST_STATUSES,
    buildResponse: buildStaffSupportRequestResponse,
    isMissingRelationError: isMissingOrderSupportRequestsRelationError,
    missingRelationMessage: "Support requests table is not initialized yet"
  });
});

router.patch("/testimonials/:id/approval", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();
    const testimonialId = String(req.params.id || "").trim();
    const { isApproved } = req.body || {};

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    if (!testimonialId) {
      return res.status(400).json({
        success: false,
        message: "Testimonial id is required"
      });
    }

    if (typeof isApproved !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isApproved must be true or false"
      });
    }

    const { data, error } = await supabase
      .from("testimonials")
      .update({
        is_approved: isApproved,
        updated_at: new Date().toISOString()
      })
      .eq("id", testimonialId)
      .eq("hotel_slug", hotelSlug)
      .select()
      .maybeSingle();

    if (error) {
      if (isMissingTestimonialsRelationError(error)) {
        return res.status(400).json({
          success: false,
          message: "Testimonials table is not initialized yet"
        });
      }

      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Testimonial not found for this hotel"
      });
    }

    res.json({
      success: true,
      message: "Testimonial approval updated",
      testimonial: buildStaffTestimonialResponse(data)
    });
  } catch (error) {
    console.error("Staff testimonial approval update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update testimonial approval"
    });
  }
});

router.patch("/orders/:id/status", requireStaffAuth, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();
    const orderId = String(req.params.id || "").trim();
    const status = getAllowedStaffStatus(req.body?.status, STAFF_ORDER_STATUSES);

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order id is required"
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${STAFF_ORDER_STATUSES.join(", ")}`
      });
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId)
      .eq("hotel_slug", hotelSlug)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Order not found for this hotel"
      });
    }

    const createdByStaffMap = await getOrderCreatedByStaffMap(supabase, [data]);

    res.json({
      success: true,
      message: "Order status updated",
      order: buildStaffOrderResponse(
        data,
        createdByStaffMap
      )
    });
  } catch (error) {
    console.error("Staff order status update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order status"
    });
  }
});

router.patch("/orders/:id/mark-billed", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();
    const orderId = String(req.params.id || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order id is required"
      });
    }

    const { data: currentOrder, error: currentOrderError } = await supabase
      .from("orders")
      .select("id,hotel_slug,hotel_name,bill_number,billing_status,billed_at")
      .eq("id", orderId)
      .eq("hotel_slug", hotelSlug)
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
        message: "Order not found for this hotel"
      });
    }

    const isAlreadyBilled = normalizeStatusValue(currentOrder.billing_status) === "billed";
    const billedAt = isAlreadyBilled && currentOrder.billed_at
      ? currentOrder.billed_at
      : new Date().toISOString();
    const updatePayload = {
      billing_status: "billed",
      billed_at: billedAt
    };

    if (!currentOrder.bill_number) {
      updatePayload.bill_number = buildOrderBillNumber(currentOrder, billedAt);
    }

    const { data, error } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .eq("hotel_slug", hotelSlug)
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

    const createdByStaffMap = await getOrderCreatedByStaffMap(supabase, [data]);

    res.json({
      success: true,
      message: "Order marked billed",
      order: buildStaffOrderResponse(
        data,
        createdByStaffMap
      )
    });
  } catch (error) {
    console.error("Staff mark billed error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark order billed"
    });
  }
});

router.patch("/orders/:id/mark-paid", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();
    const orderId = String(req.params.id || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order id is required"
      });
    }

    const { data: currentOrder, error: currentOrderError } = await supabase
      .from("orders")
      .select("id,hotel_slug,payment_status,paid_at")
      .eq("id", orderId)
      .eq("hotel_slug", hotelSlug)
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
        message: "Order not found for this hotel"
      });
    }

    const isAlreadyPaid = normalizeStatusValue(currentOrder.payment_status) === "paid";
    const paidAt = isAlreadyPaid && currentOrder.paid_at
      ? currentOrder.paid_at
      : new Date().toISOString();

    const { data, error } = await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        paid_at: paidAt
      })
      .eq("id", orderId)
      .eq("hotel_slug", hotelSlug)
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

    const createdByStaffMap = await getOrderCreatedByStaffMap(supabase, [data]);

    res.json({
      success: true,
      message: "Order marked paid",
      order: buildStaffOrderResponse(
        data,
        createdByStaffMap
      )
    });
  } catch (error) {
    console.error("Staff mark paid error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark order paid"
    });
  }
});

router.patch("/orders/:id/mark-family-billed", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();
    const orderId = String(req.params.id || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order id is required"
      });
    }

    const { parentOrder, familyOrders } = await fetchStaffOrderFamily({ hotelSlug, orderId });

    if (!parentOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found for this hotel"
      });
    }

    if (parentOrder.parent_order_id) {
      return res.status(409).json({
        success: false,
        message: "Open the parent order to mark the full table family billed"
      });
    }

    const updatedOrders = await updateStaffOrderFamilyRecords({
      familyOrders,
      buildUpdatePayload(order) {
        const isAlreadyBilled = normalizeStatusValue(order.billing_status) === "billed";
        const billedAt = isAlreadyBilled && order.billed_at
          ? order.billed_at
          : new Date().toISOString();
        const updatePayload = {
          billing_status: "billed",
          billed_at: billedAt
        };

        if (!order.bill_number) {
          updatePayload.bill_number = buildOrderBillNumber(order, billedAt);
        }

        return updatePayload;
      }
    });

    const createdByStaffMap = await getOrderCreatedByStaffMap(supabase, updatedOrders);

    res.json({
      success: true,
      message: `Marked ${updatedOrders.length} linked order${updatedOrders.length === 1 ? "" : "s"} billed`,
      orders: updatedOrders.map((order) => buildStaffOrderResponse(order, createdByStaffMap))
    });
  } catch (error) {
    if (isMissingOrderBillingColumnsError(error)) {
      return res.status(400).json({
        success: false,
        message: "Order billing fields are not initialized yet"
      });
    }

    if (isMissingOrderAddonMetadataColumnsError(error)) {
      return res.status(400).json({
        success: false,
        message: "Order add-on metadata fields are not initialized yet"
      });
    }

    console.error("Staff mark family billed error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark table family billed"
    });
  }
});

router.patch("/orders/:id/mark-family-paid", requireStaffAuth, requireStaffManagerAccess, async (req, res) => {
  try {
    const hotelSlug = String(req.staffHotelSlug || "").trim();
    const orderId = String(req.params.id || "").trim();

    if (!hotelSlug) {
      return res.status(403).json({
        success: false,
        message: "Staff hotel scope is missing"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order id is required"
      });
    }

    const { parentOrder, familyOrders } = await fetchStaffOrderFamily({ hotelSlug, orderId });

    if (!parentOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found for this hotel"
      });
    }

    if (parentOrder.parent_order_id) {
      return res.status(409).json({
        success: false,
        message: "Open the parent order to mark the full table family paid"
      });
    }

    const updatedOrders = await updateStaffOrderFamilyRecords({
      familyOrders,
      buildUpdatePayload(order) {
        const isAlreadyPaid = normalizeStatusValue(order.payment_status) === "paid";
        const paidAt = isAlreadyPaid && order.paid_at
          ? order.paid_at
          : new Date().toISOString();

        return {
          payment_status: "paid",
          paid_at: paidAt
        };
      }
    });

    const createdByStaffMap = await getOrderCreatedByStaffMap(supabase, updatedOrders);

    res.json({
      success: true,
      message: `Marked ${updatedOrders.length} linked order${updatedOrders.length === 1 ? "" : "s"} paid`,
      orders: updatedOrders.map((order) => buildStaffOrderResponse(order, createdByStaffMap))
    });
  } catch (error) {
    if (isMissingOrderBillingColumnsError(error)) {
      return res.status(400).json({
        success: false,
        message: "Order billing fields are not initialized yet"
      });
    }

    if (isMissingOrderAddonMetadataColumnsError(error)) {
      return res.status(400).json({
        success: false,
        message: "Order add-on metadata fields are not initialized yet"
      });
    }

    console.error("Staff mark family paid error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark table family paid"
    });
  }
});

router.get("/me", requireStaffAuth, (req, res) => {
  res.json({
    success: true,
    staffUser: buildStaffSessionResponse(req.staffUser)
  });
});

module.exports = router;
