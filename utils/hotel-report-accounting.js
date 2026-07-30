function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getIsoDateMs(value = "") {
  const normalized = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return Number.NaN;
  return Date.parse(`${normalized}T00:00:00.000Z`);
}

function calculateOverlappingRoomNights({ checkInDate, checkOutDate, fromDate, toDate } = {}) {
  const checkInMs = getIsoDateMs(checkInDate);
  const checkOutMs = getIsoDateMs(checkOutDate);
  const fromMs = getIsoDateMs(fromDate);
  const toMs = getIsoDateMs(toDate);
  const nightMs = 24 * 60 * 60 * 1000;

  if (![checkInMs, checkOutMs, fromMs, toMs].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round((Math.min(checkOutMs, toMs) - Math.max(checkInMs, fromMs)) / nightMs));
}

function calculateOccupancyRate(occupiedRoomNights, availableRoomNights) {
  const occupied = Math.max(0, finiteNumber(occupiedRoomNights));
  const available = Math.max(0, finiteNumber(availableRoomNights));
  return available ? (occupied / available) * 100 : 0;
}

function calculateAdr(netRoomRevenue, occupiedRoomNights) {
  const revenue = finiteNumber(netRoomRevenue);
  const occupied = Math.max(0, finiteNumber(occupiedRoomNights));
  return occupied ? revenue / occupied : 0;
}

function calculateCombinedRevenue({ foodNetRevenue, roomNetRevenue } = {}) {
  // Room Service is already part of Food net revenue. It is intentionally not
  // accepted as a separate operand, so callers cannot add it twice.
  return finiteNumber(foodNetRevenue) + finiteNumber(roomNetRevenue);
}

module.exports = {
  calculateAdr,
  calculateCombinedRevenue,
  calculateOccupancyRate,
  calculateOverlappingRoomNights
};
