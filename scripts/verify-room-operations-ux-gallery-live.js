"use strict";

require("dotenv").config({ path: ".env" });
const { createClient } = require("@supabase/supabase-js");

function fail(message, error = {}) {
  const detail = `${error.code || ""} ${error.message || ""}`.trim();
  throw new Error(detail ? `${message}: ${detail}` : message);
}

function isSafeUrl(value) {
  try { return ["http:", "https:"].includes(new URL(String(value || "")).protocol); }
  catch (_error) { return false; }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from("room_images")
    .select("id,hotel_slug,room_id,room_type_id,storage_path,original_url,card_url,optimized_url,thumbnail_url,mime_type,alt_text,display_order,is_primary,is_active,width,height,file_size,rooms(hotel_slug),room_types(hotel_slug)")
    .order("id", { ascending: false })
    .limit(2000);
  if (error) fail("Room image gallery schema is not ready", error);
  const images = data || [];
  const problems = [];
  const groups = new Map();
  for (const image of images) {
    const targets = Number(image.room_id !== null) + Number(image.room_type_id !== null);
    if (targets !== 1) problems.push(`image ${image.id} does not have exactly one target`);
    const ownerSlug = image.room_id ? image.rooms?.hotel_slug : image.room_types?.hotel_slug;
    if (String(ownerSlug || "") !== String(image.hotel_slug || "")) problems.push(`image ${image.id} has a hotel-scope mismatch`);
    if (!String(image.storage_path || "").startsWith(`${image.hotel_slug}/room-images/`) || String(image.storage_path || "").includes("..")) problems.push(`image ${image.id} has an unsafe storage path`);
    for (const field of ["original_url", "card_url", "optimized_url", "thumbnail_url"]) {
      if (!isSafeUrl(image[field])) problems.push(`image ${image.id} has an invalid ${field}`);
    }
    if (!String(image.alt_text || "").trim()) problems.push(`image ${image.id} has empty alt text`);
    if (image.is_primary && !image.is_active) problems.push(`image ${image.id} is an inactive primary`);
    const target = image.room_id ? `room:${image.room_id}` : `room_type:${image.room_type_id}`;
    const groupKey = `${image.hotel_slug}:${target}`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), image]);
  }
  for (const [groupKey, group] of groups) {
    const orders = new Set(group.map((image) => Number(image.display_order)));
    if (orders.size !== group.length) problems.push(`${groupKey} has duplicate display order values`);
    const primaryCount = group.filter((image) => image.is_primary).length;
    const activeCount = group.filter((image) => image.is_active).length;
    if (primaryCount > 1) problems.push(`${groupKey} has multiple primary images`);
    if (activeCount > 0 && primaryCount !== 1) problems.push(`${groupKey} has active images without exactly one primary`);
  }
  if (problems.length) {
    problems.slice(0, 100).forEach((problem) => console.error(`FAIL ${problem}`));
    if (problems.length > 100) console.error(`FAIL ${problems.length - 100} additional problems omitted`);
    process.exitCode = 1;
    return;
  }
  console.log("Production Room Operations gallery live schema verification passed.");
  console.log(`Room images audited: ${images.length}${images.length >= 2000 ? " (sample limit reached)" : ""}`);
  console.log("No sampled cross-hotel targets, unsafe paths, inactive primaries, or ordering conflicts were found.");
  console.log("No database writes were made.");
}

main().catch((error) => {
  console.error(`Production Room Operations gallery live verification failed: ${error.message}`);
  process.exitCode = 1;
});