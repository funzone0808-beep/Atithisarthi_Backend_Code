"use strict";

function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function addDatabaseDuration(res, durationMs) {
  if (!res?.locals || !Number.isFinite(Number(durationMs))) return;
  const current = Number(res.locals.dbDurationMs || 0);
  res.locals.dbDurationMs = current + Math.max(0, Number(durationMs));
}

async function timeDatabaseCall(res, operation) {
  const startedAt = process.hrtime.bigint();
  try {
    return await (typeof operation === "function" ? operation() : operation);
  } finally {
    addDatabaseDuration(res, elapsedMilliseconds(startedAt));
  }
}

module.exports = {
  addDatabaseDuration,
  elapsedMilliseconds,
  timeDatabaseCall
};
