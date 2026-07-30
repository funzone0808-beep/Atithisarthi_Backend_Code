"use strict";

const SCALE = 10000;
const DENOMINATOR = 100 * SCALE;
const roundMoney = (value = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
};
const toCents = (value = 0) => Math.round(roundMoney(value) * 100);
const fromCents = (value = 0) => roundMoney(Number(value || 0) / 100);
const rate = (value = 0) => Math.min(100, Math.max(0, Number(value) || 0));

function isMissingRoomTaxSchemaError(error) {
  const code = String(error?.code || "").toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) &&
    ["hotel_room_tax_settings", "room_tax_rules", "tax_snapshot"].some((name) => details.includes(name));
}

function taxConfigurationError(message, code = "ROOM_TAX_CONFIGURATION_REQUIRED") {
  return Object.assign(new Error(message), { code, status: 409 });
}

function calculateRoomTaxFromRule({ amount = 0, rule = {}, settings = {} } = {}) {
  const input = Math.max(0, toCents(amount));
  const supplyType = String(settings.default_supply_type || "intrastate").toLowerCase() === "interstate" ? "interstate" : "intrastate";
  const rates = {
    cgst: rule.is_exempt ? 0 : supplyType === "intrastate" ? rate(rule.cgst_rate) : 0,
    sgst: rule.is_exempt ? 0 : supplyType === "intrastate" ? rate(rule.sgst_rate) : 0,
    igst: rule.is_exempt ? 0 : supplyType === "interstate" ? rate(rule.igst_rate) : 0,
    cess: rule.is_exempt ? 0 : rate(rule.cess_rate)
  };
  const entries = Object.entries(rates).map(([key, percentage]) => ({ key, percentage, units: Math.round(percentage * SCALE) })).filter((item) => item.units);
  const units = entries.reduce((sum, item) => sum + item.units, 0);
  const inclusive = typeof rule.tax_inclusive === "boolean"
    ? rule.tax_inclusive
    : String(settings.default_tax_mode || "").toLowerCase() === "inclusive";
  const taxable = inclusive && units ? Math.round(input * DENOMINATOR / (DENOMINATOR + units)) : input;
  const tax = inclusive ? input - taxable : entries.reduce((sum, item) => sum + Math.round(taxable * item.units / DENOMINATOR), 0);
  let allocated = 0;
  const components = Object.fromEntries(entries.map((item, index) => {
    const amountCents = index === entries.length - 1 ? tax - allocated : Math.round(tax * item.units / units);
    allocated += amountCents;
    return [item.key, { rate: item.percentage, amount: fromCents(amountCents) }];
  }));
  const unrounded = inclusive ? input : taxable + tax;
  const roundingRule = String(settings.rounding_rule || "half_up").toLowerCase();
  const total = roundingRule === "nearest_rupee" ? Math.round(unrounded / 100) * 100 : unrounded;
  return { taxMode: inclusive ? "inclusive" : "exclusive", supplyType, taxableValue: fromCents(taxable), grossAmount: fromCents(input), components, totalTax: fromCents(tax), roundingAdjustment: fromCents(total - unrounded), totalAmount: fromCents(total), roundingRule, exempt: rule.is_exempt === true, exemptionReason: rule.is_exempt ? String(rule.exemption_reason || "") : "" };
}

function legacyTax(amount, room = {}, supportsTaxSnapshot = false) {
  const taxableValue = roundMoney(Math.max(0, Number(amount || 0)));
  const percentage = rate(room.tax_percent);
  const totalTax = roundMoney(taxableValue * percentage / 100);
  return { source: "legacy_room_tax", configured: false, supportsTaxSnapshot, gstEnabled: percentage > 0, taxMode: "exclusive", supplyType: "legacy", taxableValue, grossAmount: taxableValue, components: percentage ? { legacy: { label: "Room tax", rate: percentage, amount: totalTax } } : {}, totalTax, roundingAdjustment: 0, totalAmount: roundMoney(taxableValue + totalTax), currency: "INR" };
}

const safeEffectiveDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value))
  ? String(value)
  : new Date().toISOString().slice(0, 10);

function configuredTaxSnapshot({ amount, effectiveDate, settings, rules, guestPlaceOfSupply = "" }) {
  const taxableValue = roundMoney(Math.max(0, Number(amount || 0)));
  if (settings.gst_enabled !== true) {
    return {
      source: "hotel_room_tax_settings",
      configured: true,
      supportsTaxSnapshot: true,
      gstEnabled: false,
      configurationVersion: Number(settings.version || 1),
      taxMode: settings.default_tax_mode,
      supplyType: settings.default_supply_type,
      taxableValue,
      grossAmount: taxableValue,
      components: {},
      totalTax: 0,
      roundingAdjustment: 0,
      totalAmount: taxableValue,
      currency: settings.currency || "INR",
      exemptionReason: "GST disabled in hotel Room Tax configuration"
    };
  }
  const safeDate = safeEffectiveDate(effectiveDate);
  const rule = (rules || []).find((item) =>
    String(item.effective_from) <= safeDate &&
    (item.effective_to == null || String(item.effective_to) >= safeDate) &&
    taxableValue >= Number(item.minimum_taxable_value || 0) &&
    (item.maximum_taxable_value == null || taxableValue <= Number(item.maximum_taxable_value))
  );
  if (!rule) {
    throw taxConfigurationError(
      `No active Room GST rule is configured for ${safeDate} and the applicable taxable value.`,
      "ROOM_TAX_RULE_REQUIRED"
    );
  }
  const effectiveSettings = {
    ...settings,
    default_supply_type: guestPlaceOfSupply && settings.state_code &&
      String(guestPlaceOfSupply) !== String(settings.state_code)
      ? "interstate"
      : settings.default_supply_type
  };
  return {
    source: "room_tax_rule",
    configured: true,
    supportsTaxSnapshot: true,
    gstEnabled: true,
    configurationVersion: Number(settings.version || 1),
    ruleId: rule.id,
    ruleVersion: Number(rule.version || 1),
    ruleName: String(rule.rule_name || ""),
    category: rule.accommodation_category,
    calculationBasis: rule.calculation_basis,
    effectiveFrom: rule.effective_from,
    effectiveTo: rule.effective_to || null,
    gstin: settings.gstin || "",
    legalBusinessName: settings.legal_business_name || "",
    stateCode: settings.state_code || "",
    placeOfSupply: guestPlaceOfSupply || settings.place_of_supply || "",
    sac: settings.accommodation_sac || "",
    invoiceType: settings.invoice_type || "guest_folio",
    currency: settings.currency || "INR",
    ...calculateRoomTaxFromRule({ amount: taxableValue, rule, settings: effectiveSettings })
  };
}

function calculateRoomTaxSchedule({ lines = [], settings, rules = [], room = {}, guestPlaceOfSupply = "" } = {}) {
  if (!settings) return lines.map((line) => legacyTax(line.amount, room));
  if (settings.is_configured !== true) {
    throw taxConfigurationError(
      "Room GST settings are not configured for this hotel. A Manager must save the verified tax configuration before accepting bookings.",
      "ROOM_TAX_CONFIGURATION_REQUIRED"
    );
  }
  return lines.map((line) => configuredTaxSnapshot({
    amount: line.amount,
    effectiveDate: line.effectiveDate,
    settings,
    rules,
    guestPlaceOfSupply
  }));
}

async function resolveRoomTaxes({ supabaseClient, hotelSlug, room = {}, lines = [], guestPlaceOfSupply = "" } = {}) {
  const normalizedLines = lines.map((line) => ({
    amount: roundMoney(Math.max(0, Number(line?.amount || 0))),
    effectiveDate: safeEffectiveDate(line?.effectiveDate)
  }));
  if (!normalizedLines.length) return [];
  const settingsResult = await supabaseClient.from("hotel_room_tax_settings").select("*").eq("hotel_slug", hotelSlug).maybeSingle();
  if (settingsResult.error) {
    if (isMissingRoomTaxSchemaError(settingsResult.error)) {
      return normalizedLines.map((line) => legacyTax(line.amount, room));
    }
    throw settingsResult.error;
  }
  const settings = settingsResult.data;
  if (!settings || settings.is_configured !== true) {
    throw taxConfigurationError(
      "Room GST settings are not configured for this hotel. A Manager must save the verified tax configuration before accepting bookings.",
      "ROOM_TAX_CONFIGURATION_REQUIRED"
    );
  }
  if (settings.gst_enabled !== true) {
    return calculateRoomTaxSchedule({ lines: normalizedLines, settings, room, guestPlaceOfSupply });
  }
  const dates = normalizedLines.map((line) => line.effectiveDate).sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const rulesResult = await supabaseClient.from("room_tax_rules").select("*")
    .eq("hotel_slug", hotelSlug)
    .eq("status", "active")
    .lte("effective_from", lastDate)
    .or(`effective_to.is.null,effective_to.gte.${firstDate}`)
    .order("effective_from", { ascending: false })
    .order("version", { ascending: false })
    .limit(500);
  if (rulesResult.error) {
    if (isMissingRoomTaxSchemaError(rulesResult.error)) {
      return normalizedLines.map((line) => legacyTax(line.amount, room));
    }
    throw rulesResult.error;
  }
  return calculateRoomTaxSchedule({
    lines: normalizedLines,
    settings,
    rules: rulesResult.data || [],
    room,
    guestPlaceOfSupply
  });
}

async function resolveRoomTax({ supabaseClient, hotelSlug, room = {}, amount = 0, effectiveDate = "", guestPlaceOfSupply = "" } = {}) {
  const [snapshot] = await resolveRoomTaxes({
    supabaseClient,
    hotelSlug,
    room,
    lines: [{ amount, effectiveDate }],
    guestPlaceOfSupply
  });
  return snapshot;
}

function taxLinesFromSnapshot(snapshot = {}) {
  return Object.entries(snapshot.components || {}).map(([key, component]) => ({ key, label: component.label || `${key.toUpperCase()}${Number(component.rate || 0) ? ` @ ${Number(component.rate)}%` : ""}`, rate: roundMoney(component.rate || 0), amount: roundMoney(component.amount || 0) })).filter((line) => line.amount !== 0);
}

module.exports = {
  calculateRoomTaxFromRule,
  calculateRoomTaxSchedule,
  isMissingRoomTaxSchemaError,
  resolveRoomTax,
  resolveRoomTaxes,
  roundMoney,
  taxConfigurationError,
  taxLinesFromSnapshot
};
