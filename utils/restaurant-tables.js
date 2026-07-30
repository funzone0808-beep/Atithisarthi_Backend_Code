const { supabase } = require("./supabase");

const OPERATIONAL_STATUSES = ["active", "maintenance", "cleaning"];

function normalizeTableText(value = "", maxLength = 120) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength)
    : "";
}

function normalizeTableCode(value = "") {
  return normalizeTableText(value, 40);
}

function tableKey(value = "") {
  return normalizeTableCode(value).toLowerCase();
}

function isMissingTableMasterSchema(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) ||
    details.includes("restaurant_tables") || details.includes("restaurant_table_id") ||
    details.includes("enforce_table_master");
}

function tableResponse(row = {}) {
  return {
    id: row.id ? String(row.id) : "",
    hotelSlug: normalizeTableText(row.hotel_slug, 120),
    tableCode: normalizeTableCode(row.table_code),
    tableName: normalizeTableText(row.table_name, 120),
    displayOrder: Number(row.display_order || 0),
    capacity: row.capacity == null ? null : Number(row.capacity),
    areaName: normalizeTableText(row.area_name, 80),
    operationalStatus: OPERATIONAL_STATUSES.includes(row.operational_status) ? row.operational_status : "active",
    isActive: row.is_active !== false,
    rowVersion: Number(row.row_version || 1),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

async function resolveTableForOrder({ hotelSlug = "", restaurantTableId = "", tableNumber = "", enforceTableMaster = false } = {}) {
  const scopedHotel = normalizeTableText(hotelSlug, 120);
  const requestedCode = normalizeTableCode(tableNumber);
  const requestedId = String(restaurantTableId || "").trim();
  if (!scopedHotel || !requestedCode) return { ok: false, status: 400, code: "TABLE_REQUIRED", message: "A valid table is required for this dine-in order." };

  let query = supabase.from("restaurant_tables").select("*").eq("hotel_slug", scopedHotel);
  if (requestedId) query = query.eq("id", requestedId);
  const result = await query;
  const error = result.error;
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  const data = requestedId
    ? rows[0] || null
    : rows.find((row) => tableKey(row.table_code) === tableKey(requestedCode)) || null;

  if (error && isMissingTableMasterSchema(error) && !enforceTableMaster) return { ok: true, legacy: true, table: null, restaurantTableId: null, tableNumber: requestedCode };
  if (error && isMissingTableMasterSchema(error)) return { ok: false, status: 503, code: "TABLE_MASTER_NOT_INITIALIZED", message: "Restaurant table setup is not initialized yet." };
  if (error) throw error;
  if (!data && !enforceTableMaster && !requestedId) return { ok: true, legacy: true, table: null, restaurantTableId: null, tableNumber: requestedCode };
  if (!data) return { ok: false, status: 400, code: "TABLE_NOT_CONFIGURED", message: "The selected table is not configured for this hotel. Please select a valid table." };

  const table = tableResponse(data);
  if (!table.isActive || table.operationalStatus !== "active") return { ok: false, status: 409, code: "TABLE_NOT_OPERATIONAL", message: `Table ${table.tableCode} is not available for new orders right now.`, table };
  return { ok: true, legacy: false, table, restaurantTableId: data.id, tableNumber: table.tableCode };
}

module.exports = { OPERATIONAL_STATUSES, isMissingTableMasterSchema, normalizeTableCode, normalizeTableText, resolveTableForOrder, tableKey, tableResponse };
