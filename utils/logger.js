function normalizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return meta || "";
  }

  return meta;
}

function writeLog(level, message, meta) {
  const timestamp = new Date().toISOString();
  const normalizedMessage = String(message || "").trim() || "log";
  const normalizedMeta = normalizeMeta(meta);

  if (level === "ERROR") {
    console.error(`[${level}]`, timestamp, normalizedMessage, normalizedMeta);
    return;
  }

  if (level === "WARN") {
    console.warn(`[${level}]`, timestamp, normalizedMessage, normalizedMeta);
    return;
  }

  console.log(`[${level}]`, timestamp, normalizedMessage, normalizedMeta);
}

module.exports = {
  info(message, meta) {
    writeLog("INFO", message, meta);
  },
  warn(message, meta) {
    writeLog("WARN", message, meta);
  },
  error(message, meta) {
    writeLog("ERROR", message, meta);
  }
};
