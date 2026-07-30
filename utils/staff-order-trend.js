"use strict";

const DEFAULT_STAFF_REPORT_TIME_ZONE = "Asia/Kolkata";
const STAFF_TREND_DAYS = 7;

function normalizeStaffReportTimeZone(value = "") {
  const candidate = String(value || "").trim() || DEFAULT_STAFF_REPORT_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (_error) {
    return DEFAULT_STAFF_REPORT_TIME_ZONE;
  }
}

function getZonedDateParts(value = new Date(), timeZone = DEFAULT_STAFF_REPORT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeStaffReportTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function formatDateKey({ year, month, day } = {}) {
  return [year, month, day]
    .map((part, index) => String(Number(part || 0)).padStart(index ? 2 : 4, "0"))
    .join("-");
}

function getZonedDateKey(value = new Date(), timeZone = DEFAULT_STAFF_REPORT_TIME_ZONE) {
  return formatDateKey(getZonedDateParts(value, timeZone));
}

function addCalendarDays(dateKey = "", amount = 0) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return "";

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));

  return formatDateKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
}

function getZonedDayStart(dateKey = "", timeZone = DEFAULT_STAFF_REPORT_TIME_ZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;

  const normalizedTimeZone = normalizeStaffReportTimeZone(timeZone);
  const targetUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let guess = targetUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizedTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    const displayedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    guess -= displayedAsUtc - targetUtc;
  }

  return new Date(guess);
}

function getStaffTrendPeriod({
  now = new Date(),
  timeZone = DEFAULT_STAFF_REPORT_TIME_ZONE,
  days = STAFF_TREND_DAYS
} = {}) {
  const normalizedTimeZone = normalizeStaffReportTimeZone(timeZone);
  const safeDays = Math.min(31, Math.max(1, Number.parseInt(days, 10) || STAFF_TREND_DAYS));
  const to = getZonedDateKey(now, normalizedTimeZone);
  const from = addCalendarDays(to, -(safeDays - 1));
  const previousTo = addCalendarDays(from, -1);
  const previousFrom = addCalendarDays(previousTo, -(safeDays - 1));

  return {
    from,
    to,
    previousFrom,
    previousTo,
    timezone: normalizedTimeZone,
    days: safeDays,
    queryStart: getZonedDayStart(previousFrom, normalizedTimeZone)
  };
}

function roundCurrency(value = 0) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function isCountableTrendOrder(order = {}) {
  const status = String(order.status || "").trim().toLowerCase();
  return status !== "cancelled" && status !== "payment_failed";
}

function isRecognizedTrendRevenue(order = {}) {
  const paymentStatus = String(order.payment_status || "").trim().toLowerCase();
  return isCountableTrendOrder(order) && paymentStatus === "paid";
}

function formatTrendLabel(dateKey = "", timeZone = DEFAULT_STAFF_REPORT_TIME_ZONE) {
  const dayStart = getZonedDayStart(dateKey, timeZone);
  if (!dayStart) return dateKey;

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: normalizeStaffReportTimeZone(timeZone),
    day: "numeric",
    month: "short"
  }).format(dayStart);
}

function createTrendPoint(dateKey, timeZone) {
  return {
    date: dateKey,
    label: formatTrendLabel(dateKey, timeZone),
    orderCount: 0,
    revenue: 0
  };
}

function buildStaffOrderTrend({
  orders = [],
  period = getStaffTrendPeriod(),
  getOrderTotal = () => 0
} = {}) {
  const currentPoints = new Map();
  const previousPoints = new Map();

  for (let index = 0; index < period.days; index += 1) {
    const currentDate = addCalendarDays(period.from, index);
    const previousDate = addCalendarDays(period.previousFrom, index);
    currentPoints.set(currentDate, createTrendPoint(currentDate, period.timezone));
    previousPoints.set(previousDate, createTrendPoint(previousDate, period.timezone));
  }

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const createdAt = order?.created_at ? new Date(order.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || !isCountableTrendOrder(order)) return;

    const dateKey = getZonedDateKey(createdAt, period.timezone);
    const point = currentPoints.get(dateKey) || previousPoints.get(dateKey);
    if (!point) return;

    point.orderCount += 1;
    if (isRecognizedTrendRevenue(order)) {
      point.revenue = roundCurrency(point.revenue + Math.max(0, Number(getOrderTotal(order) || 0)));
    }
  });

  const points = [...currentPoints.values()];
  const previous = [...previousPoints.values()];
  const revenue = roundCurrency(points.reduce((sum, point) => sum + point.revenue, 0));
  const previousRevenue = roundCurrency(previous.reduce((sum, point) => sum + point.revenue, 0));
  const orderCount = points.reduce((sum, point) => sum + point.orderCount, 0);
  const previousOrderCount = previous.reduce((sum, point) => sum + point.orderCount, 0);
  const comparisonPercent = previousRevenue > 0
    ? roundCurrency(((revenue - previousRevenue) / previousRevenue) * 100)
    : null;

  return {
    period: {
      from: period.from,
      to: period.to,
      timezone: period.timezone
    },
    summary: {
      revenue,
      orderCount,
      previousRevenue,
      previousOrderCount,
      comparisonPercent
    },
    points
  };
}

module.exports = {
  DEFAULT_STAFF_REPORT_TIME_ZONE,
  STAFF_TREND_DAYS,
  addCalendarDays,
  buildStaffOrderTrend,
  getStaffTrendPeriod,
  getZonedDateKey,
  getZonedDayStart,
  isCountableTrendOrder,
  isRecognizedTrendRevenue,
  normalizeStaffReportTimeZone,
  roundCurrency
};
