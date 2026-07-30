"use strict";

const { resolveRoomTaxes } = require("./room-tax");

function roundMoney(value = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function negotiatedRateError(message, code) {
  return Object.assign(new Error(message), {
    code,
    status: 400
  });
}

function nightsBetween(checkInDate, checkOutDate) {
  const start = Date.parse(`${checkInDate}T00:00:00.000Z`);
  const end = Date.parse(`${checkOutDate}T00:00:00.000Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? Math.round((end - start) / 86400000)
    : 0;
}

function occupiedDates(checkInDate, nights) {
  const start = Date.parse(`${checkInDate}T00:00:00.000Z`);
  return Array.from({ length: nights }, (_, offset) => {
    const date = new Date(start + offset * 86400000);
    return {
      date: date.toISOString().slice(0, 10),
      dayOfWeek: date.getUTCDay()
    };
  });
}

function aggregateTaxSnapshots(nightlyRates, taxSnapshots) {
  const componentBuckets = {};
  taxSnapshots.forEach((snapshot) => {
    Object.entries(snapshot.components || {}).forEach(([key, component]) => {
      const bucket = componentBuckets[key] || { amount: 0, rates: new Set(), label: component.label || "" };
      bucket.amount += Number(component.amount || 0);
      if (Number(component.rate || 0)) bucket.rates.add(Number(component.rate));
      if (!bucket.label && component.label) bucket.label = component.label;
      componentBuckets[key] = bucket;
    });
  });
  const components = Object.fromEntries(Object.entries(componentBuckets).map(([key, bucket]) => {
    const rates = [...bucket.rates].sort((left, right) => left - right);
    const mixed = rates.length > 1;
    return [key, {
      label: mixed ? `${key.toUpperCase()} (night-wise rates)` : bucket.label || "",
      rate: rates.length === 1 ? rates[0] : 0,
      rates,
      amount: roundMoney(bucket.amount)
    }];
  }));
  const unique = (field) => [...new Set(taxSnapshots.map((snapshot) => snapshot[field]).filter((value) => value !== null && value !== undefined && value !== ""))];
  const ruleIds = unique("ruleId");
  const ruleVersions = unique("ruleVersion");
  const modes = unique("taxMode");
  const supplyTypes = unique("supplyType");
  const first = taxSnapshots[0] || {};
  return {
    source: "room_tax_nightly_schedule",
    configured: taxSnapshots.every((snapshot) => snapshot.configured === true),
    supportsTaxSnapshot: taxSnapshots.every((snapshot) => snapshot.supportsTaxSnapshot === true),
    gstEnabled: taxSnapshots.some((snapshot) => snapshot.gstEnabled === true),
    configurationVersion: first.configurationVersion || null,
    ruleId: ruleIds.length === 1 ? ruleIds[0] : null,
    ruleVersion: ruleIds.length === 1 && ruleVersions.length === 1 ? ruleVersions[0] : null,
    ruleName: ruleIds.length > 1 ? "Night-wise effective Room GST rules" : first.ruleName || "",
    taxMode: modes.length === 1 ? modes[0] : "mixed",
    supplyType: supplyTypes.length === 1 ? supplyTypes[0] : "mixed",
    taxableValue: roundMoney(taxSnapshots.reduce((sum, snapshot) => sum + Number(snapshot.taxableValue || 0), 0)),
    grossAmount: roundMoney(taxSnapshots.reduce((sum, snapshot) => sum + Number(snapshot.grossAmount || 0), 0)),
    components,
    totalTax: roundMoney(taxSnapshots.reduce((sum, snapshot) => sum + Number(snapshot.totalTax || 0), 0)),
    roundingAdjustment: roundMoney(taxSnapshots.reduce((sum, snapshot) => sum + Number(snapshot.roundingAdjustment || 0), 0)),
    totalAmount: roundMoney(taxSnapshots.reduce((sum, snapshot) => sum + Number(snapshot.totalAmount || 0), 0)),
    roundingRule: first.roundingRule || "half_up",
    gstin: first.gstin || "",
    legalBusinessName: first.legalBusinessName || "",
    stateCode: first.stateCode || "",
    placeOfSupply: first.placeOfSupply || "",
    sac: first.sac || "",
    invoiceType: first.invoiceType || "guest_folio",
    currency: first.currency || "INR",
    nightlyTaxes: taxSnapshots.map((snapshot, index) => ({
      date: nightlyRates[index]?.date,
      ratePlanId: nightlyRates[index]?.ratePlanId || null,
      configuredAmount: nightlyRates[index]?.subtotal || 0,
      taxableValue: snapshot.taxableValue,
      components: snapshot.components || {},
      totalTax: snapshot.totalTax,
      roundingAdjustment: snapshot.roundingAdjustment,
      totalAmount: snapshot.totalAmount,
      ruleId: snapshot.ruleId || null,
      ruleVersion: snapshot.ruleVersion || null,
      taxMode: snapshot.taxMode,
      exempt: snapshot.exempt === true,
      exemptionReason: snapshot.exemptionReason || ""
    }))
  };
}

function hasMoneyValue(value) {
  return value !== null &&
    value !== undefined &&
    String(value).trim() !== "" &&
    Number.isFinite(Number(value));
}

function getRoomDefaultNightlyPrice({ room = {}, roomType = null } = {}) {
  const hasDiscount = hasMoneyValue(room.discount_price);
  const roomDiscount = hasDiscount ? Number(room.discount_price) : null;
  const roomBase = hasMoneyValue(room.base_price) ? Number(room.base_price) : null;
  const typeBase = hasMoneyValue(roomType?.base_price) ? Number(roomType.base_price) : null;

  if (hasDiscount && roomDiscount >= 0) {
    return { amount: roundMoney(roomDiscount), source: "room_discount_override" };
  }
  if (roomBase !== null && roomBase > 0) {
    return { amount: roundMoney(roomBase), source: "room_override" };
  }
  return {
    amount: roundMoney(Math.max(0, typeBase === null ? 0 : typeBase)),
    source: "room_type_base"
  };
}

function missingUpgrade(error) {
  const code = String(error?.code || "").toUpperCase();
  const details = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) && details.includes("room_rate_plans");
}

async function resolveRoomBookingPricing({
  supabaseClient,
  hotelSlug,
  room,
  checkInDate,
  checkOutDate,
  adults = 1,
  children = 0,
  advancePaid = 0,
  guestPlaceOfSupply = "",
  negotiatedRate = null
}) {
  const totalNights = nightsBetween(checkInDate, checkOutDate);
  const stayDates = occupiedDates(checkInDate, totalNights);
  const lastNightDate = stayDates[stayDates.length - 1]?.date || checkInDate;
  let roomType = null;
  if (room?.room_type_id) {
    const result = await supabaseClient.from("room_types").select("id,name,base_price,base_capacity,extra_adult_rate,extra_child_rate").eq("hotel_slug", hotelSlug).eq("id", room.room_type_id).maybeSingle();
    if (!result.error) roomType = result.data;
  }

  let plans = [];
  let supportsSnapshot = true;
  let planQuery = supabaseClient.from("room_rate_plans").select("*")
    .eq("hotel_slug", hotelSlug).eq("is_active", true)
    .lte("minimum_stay", Math.max(totalNights, 1))
    .or(`start_date.is.null,start_date.lte.${lastNightDate}`)
    .or(`end_date.is.null,end_date.gte.${checkInDate}`)
    .order("priority", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (room?.room_type_id) planQuery = planQuery.or(`room_type_id.is.null,room_type_id.eq.${room.room_type_id}`);
  const planResult = await planQuery;
  if (planResult.error && missingUpgrade(planResult.error)) {
    supportsSnapshot = false;
  } else if (planResult.error) {
    throw planResult.error;
  } else {
    plans = (planResult.data || []).filter((candidate) => {
      if (candidate.status && candidate.status !== "active") return false;
      if (candidate.room_id && Number(candidate.room_id) !== Number(room?.id)) return false;
      if (candidate.room_id == null && candidate.room_type_id && Number(candidate.room_type_id) !== Number(room?.room_type_id)) return false;
      if (candidate.maximum_stay && totalNights > Number(candidate.maximum_stay)) return false;
      return true;
    }).sort((left, right) => {
      const specificity = (candidate) => candidate.room_id ? 2 : candidate.room_type_id ? 1 : 0;
      return specificity(right) - specificity(left) ||
        Number(right.priority || 0) - Number(left.priority || 0) ||
        Number(right.id || 0) - Number(left.id || 0);
    });
  }

  const defaultPrice = getRoomDefaultNightlyPrice({ room, roomType });
  const defaultNightlyPrice = defaultPrice.amount;
  const defaultPriceSource = defaultPrice.source;
  const baseOccupancy = Math.max(0, Number(room?.base_occupancy ?? roomType?.base_capacity ?? room?.max_adults ?? 1));
  const extraAdults = Math.max(0, Number(adults || 0) - baseOccupancy);
  const nightlyRates = stayDates.map(({ date, dayOfWeek }) => {
    const plan = plans.find((candidate) => {
      if (candidate.start_date && candidate.start_date > date) return false;
      if (candidate.end_date && candidate.end_date < date) return false;
      const allowedDays = Array.isArray(candidate.days_of_week)
        ? candidate.days_of_week.map(Number)
        : [];
      return !allowedDays.length || allowedDays.includes(dayOfWeek);
    }) || null;
    const nightlyPrice = plan
      ? Math.max(0, Number(plan.nightly_price || 0))
      : defaultNightlyPrice;
    const extraAdultRate = Math.max(0, Number(plan?.extra_adult_price ?? roomType?.extra_adult_rate ?? 0));
    const extraChildRate = Math.max(0, Number(plan?.extra_child_price ?? roomType?.extra_child_rate ?? 0));
    const extraGuestAmount = roundMoney(
      extraAdults * extraAdultRate + Number(children || 0) * extraChildRate
    );
    return {
      date,
      dayOfWeek,
      ratePlanId: plan?.id || null,
      ratePlanCode: plan?.plan_code || null,
      priceSource: plan ? "rate_plan" : defaultPriceSource,
      nightlyPrice: roundMoney(nightlyPrice),
      extraAdultRate,
      extraChildRate,
      extraGuestAmount,
      subtotal: roundMoney(nightlyPrice + extraGuestAmount)
    };
  });
  const configuredRoomAmount = roundMoney(
    nightlyRates.reduce((sum, night) => sum + night.subtotal, 0)
  );
  const extraGuestAmount = roundMoney(
    nightlyRates.reduce((sum, night) => sum + night.extraGuestAmount, 0)
  );
  if (totalNights > 0 && configuredRoomAmount <= 0) {
    throw Object.assign(
      new Error(
        "The selected Room does not have a positive nightly price. Configure the Room or Room Type rate before accepting this booking."
      ),
      { code: "ROOM_PRICE_NOT_CONFIGURED", status: 409 }
    );
  }
  const planIds = [...new Set(nightlyRates.map((night) => night.ratePlanId).filter(Boolean))];
  const plan = planIds.length === 1 && nightlyRates.every((night) => night.ratePlanId === planIds[0])
    ? plans.find((candidate) => Number(candidate.id) === Number(planIds[0])) || null
    : null;
  const nightlyPrice = nightlyRates.length && nightlyRates.every((night) => night.nightlyPrice === nightlyRates[0].nightlyPrice)
    ? nightlyRates[0].nightlyPrice
    : null;
  const priceSource = nightlyRates.length && nightlyRates.every((night) => night.priceSource === nightlyRates[0].priceSource)
    ? nightlyRates[0].priceSource
    : "mixed_rate_schedule";
  const requestedNegotiatedNightlyRate = Number(negotiatedRate?.nightlyRate);
  const negotiatedRateApplied =
    Number.isFinite(requestedNegotiatedNightlyRate) &&
    requestedNegotiatedNightlyRate > 0;

  if (negotiatedRateApplied) {
    const higherThanConfiguredNight = nightlyRates.find(
      (night) => requestedNegotiatedNightlyRate > Number(night.nightlyPrice || 0)
    );
    if (higherThanConfiguredNight) {
      throw negotiatedRateError(
        `Negotiated rate cannot exceed the configured rate for ${higherThanConfiguredNight.date}.`,
        "ROOM_NEGOTIATED_RATE_ABOVE_CONFIGURED"
      );
    }
  }

  const appliedNightlyRates = negotiatedRateApplied
    ? nightlyRates.map((night) => ({
        ...night,
        configuredNightlyPrice: night.nightlyPrice,
        appliedNightlyPrice: roundMoney(requestedNegotiatedNightlyRate),
        negotiatedDiscount: roundMoney(
          Math.max(0, Number(night.nightlyPrice || 0) - requestedNegotiatedNightlyRate)
        ),
        subtotal: roundMoney(requestedNegotiatedNightlyRate + Number(night.extraGuestAmount || 0))
      }))
    : nightlyRates;
  const negotiatedRoomAmount = roundMoney(
    appliedNightlyRates.reduce((sum, night) => sum + Number(night.subtotal || 0), 0)
  );
  if (negotiatedRateApplied && negotiatedRoomAmount >= configuredRoomAmount) {
    throw negotiatedRateError(
      "Negotiated rate must create a discount from the configured stay price.",
      "ROOM_NEGOTIATED_RATE_NO_DISCOUNT"
    );
  }
  const configuredTaxPromise = resolveRoomTaxes({
    supabaseClient,
    hotelSlug,
    room,
    lines: nightlyRates.map((night) => ({ amount: night.subtotal, effectiveDate: night.date })),
    guestPlaceOfSupply
  });
  const [configuredNightlyTaxSnapshots, appliedNightlyTaxSnapshots] =
    negotiatedRateApplied
      ? await Promise.all([
          configuredTaxPromise,
          resolveRoomTaxes({
            supabaseClient,
            hotelSlug,
            room,
            lines: appliedNightlyRates.map((night) => ({
              amount: night.subtotal,
              effectiveDate: night.date
            })),
            guestPlaceOfSupply
          })
        ])
      : await configuredTaxPromise.then((snapshots) => [snapshots, snapshots]);
  const configuredTaxSnapshot = aggregateTaxSnapshots(
    nightlyRates,
    configuredNightlyTaxSnapshots
  );
  const taxSnapshot = aggregateTaxSnapshots(
    appliedNightlyRates,
    appliedNightlyTaxSnapshots
  );
  const roomPrice = roundMoney(configuredTaxSnapshot.taxableValue);
  const taxAmount = roundMoney(taxSnapshot.totalTax);
  const taxPercent = roundMoney(
    Object.values(taxSnapshot.components || {})
      .reduce((sum, component) => sum + Number(component.rate || 0), 0)
  );
  if (negotiatedRateApplied && Number(taxSnapshot.taxableValue || 0) >= roomPrice) {
    throw negotiatedRateError(
      "The active GST rules do not produce a lower taxable value for this negotiated rate. Review the Room GST slab or rate.",
      "ROOM_NEGOTIATED_RATE_TAX_BASIS_CONFLICT"
    );
  }
  const discountAmount = negotiatedRateApplied
    ? roundMoney(Math.max(0, roomPrice - Number(taxSnapshot.taxableValue || 0)))
    : 0;
  const totalAmount = roundMoney(Math.max(0, taxSnapshot.totalAmount));
  const safeAdvance = roundMoney(Math.max(0, Math.min(Number(advancePaid || 0), totalAmount)));
  const configuredNightlyPrices = [
    ...new Set(nightlyRates.map((night) => roundMoney(night.nightlyPrice)))
  ];
  const negotiatedRateSnapshot = negotiatedRateApplied
    ? {
        applied: true,
        nightlyRate: roundMoney(requestedNegotiatedNightlyRate),
        configuredNightlyPrices,
        configuredAmount: configuredRoomAmount,
        negotiatedAmount: negotiatedRoomAmount,
        configuredTaxableValue: roomPrice,
        negotiatedTaxableValue: roundMoney(taxSnapshot.taxableValue),
        discountAmount,
        discountPercent: roomPrice > 0
          ? roundMoney((discountAmount / roomPrice) * 100)
          : 0,
        reason: String(negotiatedRate?.reason || "").trim().slice(0, 500),
        approvedBy: String(negotiatedRate?.approvedBy || "").trim().slice(0, 200),
        approverRole: String(negotiatedRate?.approverRole || "").trim().slice(0, 80)
      }
    : null;

  return {
    totalNights,
    roomPrice,
    taxAmount,
    discountAmount,
    totalAmount,
    advancePaid: safeAdvance,
    balanceAmount: roundMoney(totalAmount - safeAdvance),
    paymentStatus: safeAdvance <= 0 ? "unpaid" : safeAdvance >= totalAmount ? "paid" : "partial",
    ratePlanId: plan?.id || null,
    taxRuleId: taxSnapshot.ruleId || null,
    taxSnapshot,
    pricingVersion: negotiatedRateApplied ? 4 : 3,
    supportsSnapshot,
    pricingSnapshot: {
      capturedAt: new Date().toISOString(),
      roomId: room?.id || null,
      roomTypeId: room?.room_type_id || null,
      ratePlanId: plan?.id || null,
      ratePlanCode: plan?.plan_code || null,
      priceSource: negotiatedRateApplied ? "manager_negotiated_rate" : priceSource,
      nightlyPrice: negotiatedRateApplied
        ? roundMoney(requestedNegotiatedNightlyRate)
        : nightlyPrice,
      nightlyRates: appliedNightlyRates,
      configuredRoomAmount,
      ...(negotiatedRateApplied
        ? {
            configuredPriceSource: priceSource,
            configuredNightlyPrice: nightlyPrice,
            negotiatedRoomAmount,
            negotiatedRate: negotiatedRateSnapshot
          }
        : {}),
      totalNights,
      baseOccupancy,
      extraAdults,
      children: Number(children || 0),
      extraAdultRate: nightlyRates[0]?.extraAdultRate ?? 0,
      extraChildRate: nightlyRates[0]?.extraChildRate ?? 0,
      extraGuestAmount,
      roomPrice,
      taxPercent,
      taxAmount,
      discountAmount,
      totalAmount,
      taxSnapshot,
      currency: "INR"
    }
  };
}

module.exports = { getRoomDefaultNightlyPrice, resolveRoomBookingPricing };
