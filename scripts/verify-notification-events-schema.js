require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const NOTIFICATION_EVENT_PROBES = [
  { sourceType: "order", eventType: "order_created" },
  { sourceType: "reservation", eventType: "reservation_created" },
  { sourceType: "inquiry", eventType: "inquiry_created" },
  { sourceType: "contact_submission", eventType: "contact_submission_created" },
  { sourceType: "testimonial", eventType: "testimonial_submitted" },
  { sourceType: "support_request", eventType: "support_request_created" }
];

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("Notification events schema check skipped: missing Supabase environment values.");
    process.exit(1);
  }

  return createClient(url, key);
}

async function getProbeHotelSlug(supabase) {
  const configuredHotelSlug = String(process.env.NOTIFICATION_TEST_HOTEL_SLUG || "").trim();

  if (configuredHotelSlug) {
    return configuredHotelSlug;
  }

  const { data } = await supabase
    .from("hotel_notification_settings")
    .select("hotel_slug")
    .limit(1)
    .maybeSingle();

  return String(data?.hotel_slug || "hotel-sai-raj").trim();
}

async function ensureTableReadable(supabase, tableName, selectColumns = "id") {
  const { error } = await supabase
    .from(tableName)
    .select(selectColumns)
    .limit(1);

  if (error) {
    throw new Error(`${tableName}: ${error.code || "UNKNOWN"} ${error.message || ""}`.trim());
  }
}

async function runProbe(supabase, hotelSlug, sourceType, eventType) {
  const sourceId = `schema_probe_${sourceType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const updatedAt = new Date().toISOString();

  const insertResult = await supabase
    .from("notification_events")
    .insert([
      {
        hotel_slug: hotelSlug,
        source_type: sourceType,
        source_id: sourceId,
        event_type: eventType,
        delivery_channel: "internal",
        status: "pending",
        payload: { probe: true, sourceType, eventType },
        error_message: null,
        processed_at: null,
        updated_at: updatedAt
      }
    ])
    .select("id")
    .single();

  if (insertResult.error) {
    throw new Error(
      `${sourceType}/${eventType}: ${insertResult.error.code || "UNKNOWN"} ${insertResult.error.message || ""}`.trim()
    );
  }

  const probeId = insertResult.data?.id;

  if (probeId) {
    const deleteResult = await supabase
      .from("notification_events")
      .delete()
      .eq("id", probeId)
      .select("id")
      .single();

    if (deleteResult.error) {
      throw new Error(
        `Cleanup failed for ${sourceType}/${eventType}: ${deleteResult.error.code || "UNKNOWN"} ${deleteResult.error.message || ""}`.trim()
      );
    }
  }
}

async function main() {
  const supabase = getSupabaseClient();

  console.log("Notification events schema check");
  console.log("-------------------------------");

  await ensureTableReadable(supabase, "notification_events");
  await ensureTableReadable(supabase, "hotel_notification_settings", "hotel_slug");

  const hotelSlug = await getProbeHotelSlug(supabase);
  console.log(`Probe hotel slug: ${hotelSlug}`);
  console.log("Probing supported notification source/event types...");

  for (const probe of NOTIFICATION_EVENT_PROBES) {
    await runProbe(supabase, hotelSlug, probe.sourceType, probe.eventType);
    console.log(`- OK ${probe.sourceType} / ${probe.eventType}`);
  }

  console.log("");
  console.log("Notification events schema looks ready.");
}

main().catch((error) => {
  console.log("");
  console.log("Notification events schema is not ready yet.");
  console.log(error.message);
  console.log("Apply scripts/create-notification-events-table.sql for missing tables.");
  console.log("Apply scripts/update-notification-events-supported-types.sql when newer event types are rejected.");
  process.exit(1);
});
