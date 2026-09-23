"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { createClient } = require("@supabase/supabase-js");

const projectRoot = path.resolve(__dirname, "..", "..");
const outputRoot = path.join(projectRoot, "audit");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function writeJson(name, value) {
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function extractColumns(definition = {}) {
  const requiredColumns = new Set(definition.required || []);
  return Object.entries(definition.properties || {}).map(([name, property]) => ({
    name,
    type: property.format || property.type || "unknown",
    nullable: property.nullable === true || !requiredColumns.has(name),
    default: Object.prototype.hasOwnProperty.call(property, "default") ? property.default : null,
    description: property.description || null
  }));
}

async function main() {
  const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const generatedAt = new Date().toISOString();
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/openapi+json" }
  });
  if (!response.ok) throw new Error(`PostgREST metadata request failed with HTTP ${response.status}`);

  const openApi = await response.json();
  const definitions = openApi.definitions || openApi.components?.schemas || {};
  const paths = openApi.paths || {};
  const tables = Object.entries(definitions).map(([name, definition]) => ({
    schema: "public",
    name,
    columns: extractColumns(definition),
    primaryKey: null,
    primaryKeyStatus: "not exposed by PostgREST OpenAPI"
  })).sort((left, right) => left.name.localeCompare(right.name));
  const functions = Object.keys(paths).filter((entry) => entry.startsWith("/rpc/"))
    .map((entry) => ({ schema: "public", name: entry.slice(5), exposedByPostgREST: true }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const bucketResult = await supabase.storage.listBuckets();
  if (bucketResult.error) throw bucketResult.error;
  const buckets = (bucketResult.data || []).map((bucket) => ({
    name: bucket.name,
    public: bucket.public === true,
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null
  }));

  writeJson("database-schema.json", {
    generatedAt,
    source: "configured Supabase PostgREST OpenAPI (read-only)",
    limitations: [
      "PostgREST OpenAPI does not expose complete PostgreSQL constraints, indexes, triggers, owners, extensions, grants, or role attributes.",
      "No table rows were read."
    ],
    tableCount: tables.length,
    tables,
    exposedFunctionCount: functions.length,
    exposedFunctions: functions,
    storage: { bucketCount: buckets.length, buckets }
  });
  writeJson("database-rls.json", {
    generatedAt,
    source: "not available through configured PostgREST credentials",
    status: "UNVERIFIED",
    reason: "Requires read-only SQL catalog access to pg_class and pg_policies. Migration SQL is not treated as live-state evidence.",
    policies: []
  });
  writeJson("database-grants.json", {
    generatedAt,
    source: "not available through configured PostgREST credentials",
    status: "UNVERIFIED",
    reason: "Requires read-only SQL catalog access to information_schema and pg_catalog. Migration SQL is not treated as live-state evidence.",
    roles: [],
    grants: []
  });
  console.log(`Database inventory written: ${tables.length} tables, ${functions.length} exposed RPCs, ${buckets.length} storage buckets.`);
  console.log("RLS, roles, grants, triggers, indexes, constraints, views, and extensions remain UNVERIFIED without SQL catalog access.");
}

main().catch((error) => {
  console.error(`Database inventory failed: ${error.message}`);
  process.exitCode = 1;
});
