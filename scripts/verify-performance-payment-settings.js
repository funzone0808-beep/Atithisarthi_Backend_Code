"use strict";

const fs = require("fs");
const path = require("path");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const liveMode = process.argv.includes("--live");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.resolve(projectRoot, relativePath), "utf8");
}

function requireCheck(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  const message = detail ? `${label}: ${detail}` : label;
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function includesAll(source, values) {
  return values.every((value) => source.includes(value));
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex < 0 ? source.length : endIndex);
}

function verifySourceContracts() {
  const staffFrontend = read("frontend/js/staff-orders.js");
  const checkoutFrontend = read("frontend/js/main.js");
  const adminFrontend = read("frontend/js/admin.js");
  const adminHtml = read("frontend/admin.html");
  const staffHtml = read("frontend/staff-orders.html");
  const staffRoute = read("backend/routes/staff.js");
  const orderRoute = read("backend/routes/orders.js");
  const qrRoute = read("backend/routes/public-qr.js");
  const paymentRoute = read("backend/routes/payments.js");
  const adminRoute = read("backend/routes/admin.js");
  const publicRoute = read("backend/routes/public.js");
  const settingsUtility = read("backend/utils/hotel-ordering-settings.js");
  const validator = read("backend/validators/admin.js");
  const staffValidator = read("backend/validators/staff.js");
  const observability = read("backend/middleware/request-observability.js");
  const migration = read("backend/scripts/upgrade-production-performance-payment-settings.sql");
  const rollback = read("backend/scripts/rollback-production-performance-payment-settings.sql");
  const managerSettingsHandler = section(
    staffFrontend,
    "async function handleStaffPaymentMethodSettingsSubmit",
    "function getStaffTableOrderingDisabledMessage"
  );
  const mutationUpdater = section(
    staffFrontend,
    "function applyStaffOrderMutationResult",
    "function findStaffKdsOrder"
  );
  const refreshCoordinator = section(
    staffFrontend,
    "async function refreshStaffOperationalData",
    "function stopStaffAutoRefresh"
  );
  const ordersReadRoute = section(
    staffRoute,
    'router.get("/orders",',
    'router.post("/orders",'
  );

  requireCheck(
    "Orders polling is active-view scoped",
    includesAll(refreshCoordinator, [
      '["dashboard", "orders"].includes(STAFF_STATE.activeView)',
      'STAFF_STATE.activeView === "table-order"',
      'STAFF_STATE.tableOrderSubview === "tables"',
      '["dashboard", "rooms"].includes(STAFF_STATE.activeView)'
    ])
  );
  requireCheck(
    "KDS and normal views use separate bounded refresh cadences",
    staffFrontend.includes("STAFF_KDS_AUTO_REFRESH_INTERVAL_MS = 3 * 1000") &&
      staffFrontend.includes("STAFF_AUTO_REFRESH_INTERVAL_MS = 3 * 1000") &&
      section(staffFrontend, "function openStaffView", "function setStaffTabCount")
        .includes("startStaffAutoRefresh()")
  );
  requireCheck(
    "Stale Orders reads are cancelled",
    includesAll(staffFrontend, [
      "staffOrdersRequestController.abort()",
      "new AbortController()",
      "signal: requestController.signal",
      'error?.name === "AbortError"'
    ])
  );
  requireCheck(
    "Mark Bill/Paid repaint only affected order components",
    includesAll(mutationUpdater, [
      '[data-staff-order-details]',
      "currentCard.outerHTML = buildStaffOrderCard(order)",
      "renderStaffTableActivity()"
    ]) &&
      !mutationUpdater.includes("loadStaffOrders(") &&
      !mutationUpdater.includes("loadStaffTableActivity(")
  );
  requireCheck(
    "Financial actions wait for the backend while showing local processing",
    includesAll(staffFrontend, [
      'button.textContent = "Updating..."',
      "await patchStaffOrderAction(orderId, action)",
      "applyStaffOrderMutationResult(result, orderId)"
    ])
  );
  requireCheck(
    "Orders list uses an explicit summary projection",
    ordersReadRoute.includes(".select(STAFF_ORDER_LIST_FIELDS)") &&
      !ordersReadRoute.includes('.select("*")') &&
      ordersReadRoute.includes(".limit(limit)")
  );
  requireCheck(
    "Mark Bill and Mark Paid use optimistic order-version guards",
    (staffRoute.match(/\.eq\("order_version", currentVersion\)/g) || []).length >= 2 &&
      (staffRoute.match(/code: "ORDER_VERSION_CONFLICT"/g) || []).length >= 2 &&
      (staffRoute.match(/idempotentReplay: true/g) || []).length >= 4
  );
  requireCheck(
    "Request observability exposes safe correlation and server timing",
    includesAll(observability, [
      'res.setHeader("x-request-id", requestId)',
      'res.setHeader("server-timing"',
      "durationMs",
      "responseBytes",
      "hotelHint"
    ]) &&
      staffRoute.includes("timeDatabaseCall(res, query)")
  );
  requireCheck(
    "Hotel payment settings have backward-compatible enabled defaults and hotel cache keys",
    includesAll(settingsUtility, [
      "settingsRow?.secure_online_payment_enabled !== undefined",
      "settingsRow?.cash_on_delivery_enabled !== undefined",
      "settingsRow?.manual_upi_payment_enabled !== undefined",
      "ORDERING_SETTINGS_CACHE_TTL_MS",
      "invalidateHotelOrderingSettings",
      'code: "PAYMENT_METHOD_DISABLED"'
    ])
  );
  requireCheck(
    "Every new customer-order path enforces the hotel payment switch",
    orderRoute.includes("isHotelPaymentMethodEnabled(orderingSettings, paymentMethod)") &&
      qrRoute.includes("isHotelPaymentMethodEnabled(orderingSettings, req.validatedBody.paymentMethod)") &&
      paymentRoute.includes('isHotelPaymentMethodEnabled(orderingSettings, "ONLINE_GATEWAY")')
  );
  requireCheck(
    "Admin settings remain behind admin authentication and invalidate the cache",
    adminRoute.indexOf("router.use(requireAdminAuth)") >= 0 &&
      adminRoute.indexOf("router.use(requireAdminAuth)") < adminRoute.indexOf('router.get("/ordering-settings/:slug"') &&
      adminRoute.includes("invalidateHotelOrderingSettings(hotelSlug)")
  );
  requireCheck(
    "At least one customer payment method is required while ordering is enabled",
    includesAll(validator, [
      "secureOnlinePaymentEnabled: z.boolean().optional()",
      "cashOnDeliveryEnabled: z.boolean().optional()",
      "manualUpiPaymentEnabled: z.boolean().optional()",
      "Enable at least one customer payment method"
    ])
  );
  requireCheck(
    "Hotel Managers can save only their signed-token hotel payment settings",
    includesAll(staffRoute, [
      '"/ordering-settings/payment-methods"',
      "requireStaffAuth",
      "requireStaffManagerAccess",
      'const hotelSlug = String(req.staffHotelSlug || "").trim()',
      "validateBody(staffPaymentMethodSettingsSchema)",
      "invalidateHotelOrderingSettings(hotelSlug)"
    ]) &&
      includesAll(staffValidator, [
        "staffPaymentMethodSettingsSchema",
        "Enable at least one customer payment method"
      ]) &&
      includesAll(staffHtml, [
        "staffPaymentMethodSettingsForm",
        "staffSecureOnlinePaymentEnabledInput",
        "staffCashOnDeliveryEnabledInput",
        "staffManualUpiPaymentEnabledInput"
      ]) &&
      managerSettingsHandler.includes("isStaffManagerSession()") &&
      managerSettingsHandler.includes("ordering-settings/payment-methods") &&
      !managerSettingsHandler.includes("hotelSlug")
  );
  requireCheck(
    "Admin and customer UIs expose the exact mapped switches",
    includesAll(adminHtml, [
      "orderingSecureOnlinePaymentEnabledInput",
      "orderingCashOnDeliveryEnabledInput",
      "orderingManualUpiPaymentEnabledInput"
    ]) &&
      includesAll(adminFrontend, [
        "secureOnlinePaymentEnabled",
        "cashOnDeliveryEnabled",
        "manualUpiPaymentEnabled"
      ]) &&
      includesAll(checkoutFrontend, [
        "getPaymentMethodAvailability",
        "syncPaymentMethodAvailability",
        "No payment method is currently available",
        "CONFIG.OWNER_UPI_ID"
      ]) &&
      includesAll(publicRoute, [
        "secureOnlinePaymentEnabled",
        "cashOnDeliveryEnabled",
        "manualUpiPaymentEnabled"
      ])
  );
  requireCheck(
    "Manual UPI requires the hotel UPI dependency in UI and direct APIs",
    orderRoute.includes("PAYMENT_METHOD_NOT_CONFIGURED") &&
      orderRoute.includes("owner_upi_id") &&
      qrRoute.includes("PAYMENT_METHOD_NOT_CONFIGURED") &&
      checkoutFrontend.includes('Boolean(String(CONFIG.OWNER_UPI_ID || "").trim())')
  );
  requireCheck(
    "Migration is additive, hotel-scoped, audited, protected, indexed, and reversible",
    includesAll(migration, [
      "alter table public.hotel_ordering_settings",
      "hotel_ordering_settings_customer_payment_method_check",
      "hotel_ordering_settings_audit",
      "trg_audit_hotel_ordering_settings",
      "enable row level security",
      "revoke all on table public.hotel_ordering_settings",
      "create index concurrently if not exists idx_orders_hotel_created_desc"
    ]) &&
      includesAll(rollback, [
        "Safe operational rollback",
        "Existing orders and historical payments are not changed",
        "drop index concurrently if exists",
        "Deliberately retained"
      ]) &&
      !migration.includes("update public.orders") &&
      !migration.includes("delete from public.orders")
  );
}

async function verifyLiveSchema() {
  require("dotenv").config({ path: path.resolve(backendRoot, ".env") });
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: settings, error: settingsError } = await supabase
    .from("hotel_ordering_settings")
    .select("hotel_slug,customer_ordering_enabled,secure_online_payment_enabled,cash_on_delivery_enabled,manual_upi_payment_enabled,updated_at")
    .limit(2000);
  if (settingsError) throw new Error(`Payment settings schema is not ready: ${settingsError.message}`);
  const invalid = (settings || []).filter((row) =>
    row.customer_ordering_enabled !== false &&
    !row.secure_online_payment_enabled &&
    !row.cash_on_delivery_enabled &&
    !row.manual_upi_payment_enabled
  );
  requireCheck("Live settings contain no ordering-enabled hotel with zero payment methods", invalid.length === 0);

  const { error: auditError } = await supabase
    .from("hotel_ordering_settings_audit")
    .select("id,hotel_slug,action,old_values,new_values,changed_at,changed_by")
    .limit(1);
  if (auditError) throw new Error(`Payment settings audit is not ready: ${auditError.message}`);

  const { error: orderVersionError } = await supabase
    .from("orders")
    .select("id,hotel_slug,order_version,billing_status,payment_status")
    .limit(1);
  if (orderVersionError) throw new Error(`Order concurrency columns are not ready: ${orderVersionError.message}`);
  console.log(`PASS Live payment settings and audit are queryable (${(settings || []).length} settings rows sampled)`);
  console.log("PASS Live verification made no database writes");
}

async function main() {
  verifySourceContracts();
  if (liveMode) await verifyLiveSchema();
  if (failures.length) {
    throw new Error(`${failures.length} performance/payment contract check(s) failed`);
  }
  console.log(liveMode
    ? "Production performance/payment live verification passed."
    : "Production performance/payment source verification passed.");
}

main().catch((error) => {
  console.error(`Production performance/payment verification failed: ${error.message}`);
  process.exitCode = 1;
});
