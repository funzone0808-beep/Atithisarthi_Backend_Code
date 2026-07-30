const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(projectRoot, "frontend", "staff-orders.html"), "utf8");
const script = fs.readFileSync(path.join(projectRoot, "frontend", "js", "staff-orders.js"), "utf8");
const staffRoute = fs.readFileSync(path.join(projectRoot, "backend", "routes", "staff.js"), "utf8");

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}`);
  }
}

function main() {
  requirePattern(html, /id="staffTakeOrderHome"[\s\S]*>View Tables<[\s\S]*>Create New Order</m, "Take Order home actions");
  requirePattern(html, /id="staffTakeOrderTablesView"[^>]*hidden[\s\S]*id="staffTakeOrderTableSearchInput"[\s\S]*data-staff-table-activity-status="preparing"[\s\S]*id="staffTakeOrderTableContent"/m, "active table subview controls");
  requirePattern(html, /id="staffTakeOrderCreateView"[^>]*hidden[\s\S]*id="staffTableOrderForm"/m, "preserved form inside create subview");
  requirePattern(html, /id="staffTableOrderTableInput"[^>]*name="tableNumber"[^>]*required/m, "preserved table field contract");
  requirePattern(html, /id="staffTableOrderConflictActions"[^>]*hidden[\s\S]*id="staffTableOrderOpenExistingBtn"[\s\S]*id="staffTableOrderChooseDifferentBtn"/m, "active table conflict actions");
  requirePattern(html, /id="staffTakeOrderProgress"[\s\S]*data-staff-take-order-progress="table"[\s\S]*data-staff-take-order-progress="guest"[\s\S]*data-staff-take-order-progress="menu"[\s\S]*data-staff-take-order-progress="review"/m, "four-stage Create New Order progress");
  requirePattern(html, /staffTakeOrderTableStepTitle[\s\S]*id="staffTableOrderTableInput"[\s\S]*staffTakeOrderGuestStepTitle[\s\S]*id="staffTableOrderCustomerNameInput"[\s\S]*staffTakeOrderReviewStepTitle[\s\S]*id="staffTableOrderCartSummary"/m, "preserved controls grouped into guided sections");
  requirePattern(html, /staff-table-order-menu-navigation[\s\S]*id="staffTableOrderSearchInput"[\s\S]*id="staffTableOrderCategoryFilter"[\s\S]*id="staffTableOrderCategoryPills"/m, "sticky large-menu navigation");
  requirePattern(html, /id="staffTableOrderMobileBar"[^>]*hidden[\s\S]*id="staffTableOrderMobileCartBtn"[\s\S]*id="staffTableOrderMobileSheet"[\s\S]*form="staffTableOrderForm"[\s\S]*data-staff-table-order-submit/m, "mobile cart summary and review sheet");
  requirePattern(html, /@media \(min-width: 761px\)[\s\S]*#staffTableOrderPanel \.staff-table-order-form[\s\S]*position: sticky/m, "sticky desktop order form");
  requirePattern(html, /#staffTableOrderPanel \.staff-take-order-action-grid[\s\S]*grid-template-columns: repeat\(2/m, "scoped desktop action grid");
  requirePattern(html, /@media \(max-width: 760px\)[\s\S]*#staffTableOrderPanel \.staff-take-order-action-grid[\s\S]*grid-template-columns: 1fr/m, "mobile action stacking");
  requirePattern(script, /tableOrderSubview: "home"/m, "Take Order internal view state");
  requirePattern(script, /function showStaffTakeOrderSubview\(view = "home"[\s\S]*allowedViews = \["home", "tables", "create"\]/m, "internal subview controller");
  requirePattern(script, /if \(nextView === "create"\)[\s\S]*if \(!STAFF_STATE\.tableOrderMenuLoaded\)[\s\S]*loadStaffTableOrderMenu\(\)/m, "create-only lazy menu loading");
  requirePattern(script, /if \(nextView === "table-order"\)[\s\S]*showStaffTakeOrderSubview\("home", \{ focus: false \}\)[\s\S]*loadStaffOrderingSettings\(\)/m, "same-route home entry");
  requirePattern(script, /takeOrderOpenCreateButton\.addEventListener\("click"[\s\S]*showStaffTakeOrderSubview\("create"\)/m, "Create New Order action");
  requirePattern(script, /async function loadStaffTableActivity[\s\S]*\/orders\/table-activity[\s\S]*renderStaffTableActivity\(\)/m, "hotel-scoped table activity loading");
  requirePattern(script, /function buildStaffTableActivityCard[\s\S]*data-staff-open-table-order/m, "active table cards");
  requirePattern(html, /id="staffTakeOrderTableWorkspace"[\s\S]*id="staffTakeOrderDetailPanel"[\s\S]*id="staffTakeOrderDetailCloseBtn"[\s\S]*id="staffTakeOrderDetailContent"/m, "same-page selected order detail panel");
  requirePattern(script, /async function openStaffOrderFromTableActivity[\s\S]*selectedTableOrderId = normalizedOrderId[\s\S]*loadSelectedStaffTableOrder\(\)/m, "same-page open existing order action");
  requirePattern(script, /function closeStaffTableOrderDetail[\s\S]*tableActivityScrollTop[\s\S]*data-staff-open-table-order/m, "table context restoration");
  requirePattern(script, /async function checkStaffTableOrderAvailability[\s\S]*\/orders\/active-table\?/m, "pre-submit table availability check");
  requirePattern(script, /Checking table availability[\s\S]*checkStaffTableOrderAvailability\(tableNumber\)[\s\S]*showStaffTableOrderConflict\(availability\.activeOrder/m, "availability conflict before create");
  requirePattern(script, /isStaffTableOrderConflictError\(error\)[\s\S]*showStaffTableOrderConflict\(error\.responseData\?\.activeOrder/m, "atomic create conflict fallback");
  requirePattern(script, /tableOrderOpenExistingButton\.addEventListener\("click"[\s\S]*openStaffOrderFromTableActivity\(orderId\)/m, "authorized open existing order control");
  requirePattern(script, /function syncStaffTakeOrderProgress\(\)[\s\S]*getStaffTableOrderCartEntries\(\)[\s\S]*currentStep[\s\S]*aria-current[\s\S]*data-staff-take-order-progress-status/m, "state-driven accessible progress");
  requirePattern(script, /tableOrderForm\.addEventListener\("input"[\s\S]*syncStaffTakeOrderProgress\(\)/m, "live progress updates");
  requirePattern(script, /categoryCounts[\s\S]*All Items[\s\S]*data-staff-table-order-category[\s\S]*aria-pressed/m, "category pills with live counts");
  requirePattern(script, /staffTableOrderSearchTimer[\s\S]*setTimeout\([\s\S]*renderStaffTableOrderMenu\(\)[\s\S]*240/m, "debounced local menu search");
  requirePattern(script, /tableOrderCategoryPills\.addEventListener\("click"[\s\S]*setStaffTableOrderMenuCategory/m, "category pill interaction");
  requirePattern(script, /function renderStaffTableOrderMobileCart[\s\S]*Estimated subtotal[\s\S]*buildStaffTableOrderCartMetaMarkup/m, "mobile review rendered from existing cart state");
  requirePattern(script, /function setStaffTableOrderSubmitBusy[\s\S]*data-staff-table-order-submit[\s\S]*setStaffActionBusyState/m, "all Place Order controls share busy state");
  requirePattern(script, /tableOrderMobileCartButton\.addEventListener\("click"[\s\S]*openStaffTableOrderMobileSheet/m, "mobile review open action");
  requirePattern(script, /tableOrderMobileSheet\.addEventListener\("close"[\s\S]*tableOrderMobileCartButton\?\.focus/m, "mobile sheet focus return");
  requirePattern(staffRoute, /router\.get\("\/orders\/table-activity", requireStaffAuth[\s\S]*\.eq\("hotel_slug", hotelSlug\)[\s\S]*\.eq\("order_type", "dine-in"\)[\s\S]*\.is\("parent_order_id", null\)[\s\S]*\.in\("status", STAFF_ACTIVE_TABLE_ORDER_STATUSES\)/m, "trusted active root-order endpoint");
  requirePattern(staffRoute, /function groupStaffActiveTableOrders[\s\S]*table_number[\s\S]*toLowerCase\(\)[\s\S]*activeRecordCount[\s\S]*groupStaffActiveTableOrders\(data\)/m, "one card per normalized table scope");
  requirePattern(script, /function getStaffTableOrderSubmitErrorMessage\(error\)[\s\S]*responseData\?\.details[\s\S]*path\.includes\("items"\)/m, "actionable item validation message");
  requirePattern(script, /isStaffTableOrderItemValidationError\(error\)[\s\S]*loadStaffTableOrderMenu\(\{ silent: true \}\)[\s\S]*live menu has been refreshed/m, "stale menu recovery");

  console.log("Staff Take Order home verification passed.");
  console.log("Verified same-panel home, trusted active-table grid, preserved form contracts, lazy menu loading, and responsive layout.");
}

main();
