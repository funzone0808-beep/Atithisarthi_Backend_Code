"use strict";

// Read-only staged load harness. It never calls mutation endpoints.
// Real multi-tenant evidence requires one scoped token per represented hotel.

const { performance } = require("perf_hooks");

const baseUrl = String(process.env.PERF_BASE_URL || "http://127.0.0.1:5000")
  .trim()
  .replace(/\/$/, "");
const stages = String(process.env.PERF_STAGES || "10,25,50,100,200")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0 && value <= 200);
const durationMs = Math.max(1000, Number(process.env.PERF_STAGE_DURATION_MS || 10000));
const timeoutMs = Math.max(500, Number(process.env.PERF_REQUEST_TIMEOUT_MS || 5000));
const profile = String(process.env.PERF_PROFILE || "health").trim().toLowerCase();
const requireDistinctTenants = String(process.env.PERF_REQUIRE_DISTINCT_TENANTS || "false")
  .trim()
  .toLowerCase() === "true";

function parseJsonEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must contain valid JSON: ${error.message}`);
  }
}

function getProfilePaths() {
  if (profile === "health") return ["/api/health", "/api/readiness"];
  if (profile === "staff-read") {
    return [
      "/api/staff/orders?range=recent&limit=50",
      "/api/staff/orders/table-activity?status=all",
      "/api/staff/menu"
    ];
  }
  if (profile === "custom") {
    const paths = parseJsonEnv("PERF_READ_PATHS_JSON", []);
    if (!Array.isArray(paths) || !paths.length) {
      throw new Error("PERF_READ_PATHS_JSON must be a non-empty JSON array in custom mode");
    }
    return paths;
  }
  throw new Error("PERF_PROFILE must be health, staff-read, or custom");
}

function normalizePath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/api/")) {
    throw new Error(`Only local API paths are allowed: ${path || "(empty)"}`);
  }
  if (/\s/.test(path)) throw new Error(`API path cannot contain whitespace: ${path}`);
  return path;
}

function getTenantContexts() {
  const configured = parseJsonEnv("PERF_TENANTS_JSON", []);
  if (Array.isArray(configured) && configured.length) {
    return configured.map((entry, index) => ({
      hotelSlug: String(entry?.hotelSlug || `tenant-${index + 1}`).trim(),
      token: String(entry?.token || "").trim()
    }));
  }

  const token = String(process.env.PERF_STAFF_TOKEN || "").trim();
  const hotelSlug = String(process.env.PERF_HOTEL_SLUG || "single-test-tenant").trim();
  return [{ hotelSlug, token }];
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(Number(value || 0) * factor) / factor;
}

async function executeRead(path, context) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const headers = {
      accept: "application/json",
      "x-performance-test": "readonly-staged"
    };
    if (context.token) headers.authorization = `Bearer ${context.token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const body = await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      durationMs: performance.now() - startedAt,
      bytes: body.byteLength,
      requestId: response.headers.get("x-request-id") || "",
      serverTiming: response.headers.get("server-timing") || ""
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - startedAt,
      bytes: 0,
      error: error.name === "AbortError" ? "timeout" : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runWorker(workerIndex, deadline, paths, tenants, results) {
  let requestIndex = workerIndex;
  while (performance.now() < deadline) {
    const context = tenants[requestIndex % tenants.length];
    const path = paths[requestIndex % paths.length];
    const result = await executeRead(path, context);
    results.push({ ...result, path, hotelSlug: context.hotelSlug });
    requestIndex += 1;
  }
}

function summarize(stage, elapsedMs, results, memoryBefore, memoryAfter, tenantCount) {
  const latencies = results.map((entry) => entry.durationMs);
  const failures = results.filter((entry) => !entry.ok);
  const timeouts = results.filter((entry) => entry.error === "timeout");
  const totalBytes = results.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
  const statuses = results.reduce((summary, entry) => {
    const key = String(entry.status || entry.error || "unknown");
    summary[key] = Number(summary[key] || 0) + 1;
    return summary;
  }, {});
  return {
    concurrentClients: stage,
    distinctTenantCredentials: tenantCount,
    requests: results.length,
    elapsedSeconds: round(elapsedMs / 1000),
    throughputRps: round(results.length / Math.max(0.001, elapsedMs / 1000)),
    p50Ms: round(percentile(latencies, 0.5)),
    p95Ms: round(percentile(latencies, 0.95)),
    p99Ms: round(percentile(latencies, 0.99)),
    errorRatePercent: round((failures.length / Math.max(1, results.length)) * 100),
    timeoutRatePercent: round((timeouts.length / Math.max(1, results.length)) * 100),
    responseMegabytes: round(totalBytes / (1024 * 1024)),
    clientRssDeltaMegabytes: round((memoryAfter.rss - memoryBefore.rss) / (1024 * 1024)),
    statuses
  };
}

async function runStage(stage, paths, tenants) {
  const memoryBefore = process.memoryUsage();
  const results = [];
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  await Promise.all(
    Array.from({ length: stage }, (_, index) =>
      runWorker(index, deadline, paths, tenants, results)
    )
  );
  const elapsedMs = performance.now() - startedAt;
  return summarize(
    stage,
    elapsedMs,
    results,
    memoryBefore,
    process.memoryUsage(),
    tenants.length
  );
}

async function main() {
  if (!stages.length) throw new Error("PERF_STAGES did not contain any values from 1 to 200");
  const paths = getProfilePaths().map(normalizePath);
  const tenants = getTenantContexts();
  if (profile !== "health" && tenants.some((context) => !context.token)) {
    throw new Error("Authenticated read profiles require PERF_STAFF_TOKEN or tokens in PERF_TENANTS_JSON");
  }
  if (requireDistinctTenants && tenants.length < Math.max(...stages)) {
    throw new Error(
      `Distinct-tenant mode requires at least ${Math.max(...stages)} scoped credentials; received ${tenants.length}`
    );
  }

  console.log(JSON.stringify({
    type: "readonly-load-test",
    baseUrl,
    profile,
    paths,
    stages,
    stageDurationMs: durationMs,
    distinctTenantCredentials: tenants.length,
    limitation: tenants.length < Math.max(...stages)
      ? "Concurrency is simulated, but this run does not prove the same number of distinct hotels."
      : "Each configured tenant credential can represent a distinct hotel."
  }));

  for (const stage of stages) {
    const summary = await runStage(stage, paths, tenants);
    console.log(JSON.stringify({ type: "stage-result", ...summary }));
  }
}

main().catch((error) => {
  console.error(`Read-only load test failed: ${error.message}`);
  process.exitCode = 1;
});
