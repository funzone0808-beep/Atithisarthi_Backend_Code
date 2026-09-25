"use strict";

const crypto = require("crypto");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const EVENT_ID = "TEST_TASK2B_LEASE_RECOVERY_20260925_V2";
const CRASHED_OWNER = "TEST_TASK2B_CRASHED_WORKER";
const COMPETING_OWNER = "TEST_TASK2B_COMPETING_WORKER";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readEvent(db) {
  const result = await db.from("payment_webhook_inbox")
    .select("id,provider,merchant_ref,provider_event_id,event_type,status,attempt_count,payment_intent_id,received_at,processed_at,lease_until")
    .eq("provider", "razorpay")
    .eq("merchant_ref", "LEGACY_PLATFORM_RAZORPAY")
    .eq("provider_event_id", EVENT_ID)
    .maybeSingle();
  if (result.error) throw new Error(`Lease event read failed: ${result.error.message}`);
  return result.data || null;
}

async function assertNoOtherClaimableEvent(db) {
  const result = await db.from("payment_webhook_inbox")
    .select("provider_event_id,status,lease_until")
    .in("status", ["RECEIVED", "PROCESSING", "FAILED"]);
  if (result.error) throw new Error(`Claimable-event preflight failed: ${result.error.message}`);
  const now = Date.now();
  const claimable = (result.data || []).filter((row) => (
    row.status === "RECEIVED" || row.status === "FAILED" ||
    (row.status === "PROCESSING" && new Date(row.lease_until || 0).getTime() < now)
  ));
  assert(claimable.length === 0, "Another webhook is already claimable; aborting isolated lease test");
}

async function readFinancialState(db) {
  const [intent, order, attempts] = await Promise.all([
    db.from("payment_intents").select("id,status,version,provider_order_id,provider_payment_id,paid_at")
      .eq("id", "db4580a8-d549-4965-9b38-2d649dedc1fa").single(),
    db.from("orders").select("id,payment_status,gateway_order_id,gateway_payment_id,paid_at")
      .eq("id", 262).single(),
    db.from("payment_attempts").select("id", { count: "exact", head: true })
      .eq("payment_intent_id", "db4580a8-d549-4965-9b38-2d649dedc1fa")
  ]);
  for (const [name, result] of [["intent", intent], ["order", order], ["attempts", attempts]]) {
    if (result.error) throw new Error(`${name} read failed: ${result.error.message}`);
  }
  return { intent: intent.data, order: order.data, attemptCount: attempts.count };
}

async function waitForRecovery(db) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const event = await readEvent(db);
    if (event?.status === "PROCESSED") return event;
    if (event?.status === "DEAD_LETTER") throw new Error("Lease recovery event entered DEAD_LETTER");
    await sleep(1000);
  }
  throw new Error("Periodic worker did not recover the expired lease within 25 seconds");
}

async function main() {
  const keyId = required("RAZORPAY_KEY_ID");
  assert(!keyId.startsWith("rzp_live_"), "LIVE Razorpay key detected; aborting");
  assert(keyId.startsWith("rzp_test_"), "A Razorpay TEST key is required");
  const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "servehotels-task2b-lease-recovery" } }
  });

  await assertNoOtherClaimableEvent(db);
  assert(!(await readEvent(db)), "Lease recovery event already exists; refusing to overwrite evidence");
  const before = await readFinancialState(db);
  assert(before.intent.status === "PAID" && before.order.payment_status === "paid", "Financial baseline is not PAID");

  const payload = { event: "task2b.lease_recovery", id: EVENT_ID, payload: {}, synthetic: true };
  const payloadDigest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  // Start safely in the future even when the application host and database clocks
  // differ. The row's database-generated received_at is then used to set the
  // actual five-second test lease.
  const leaseUntil = new Date(Date.now() + (15 * 60 * 1000)).toISOString();
  const insert = await db.from("payment_webhook_inbox").insert([{
    provider: "razorpay",
    merchant_ref: "LEGACY_PLATFORM_RAZORPAY",
    provider_event_id: EVENT_ID,
    payload_digest: payloadDigest,
    event_type: "task2b.lease_recovery",
    payload,
    status: "PROCESSING",
    attempt_count: 1,
    lease_owner: CRASHED_OWNER,
    lease_until: leaseUntil
  }]).select("id,status,attempt_count,received_at,lease_until").single();
  if (insert.error) throw new Error(`Synthetic lease insert failed: ${insert.error.message}`);

  const databaseLeaseUntil = new Date(new Date(insert.data.received_at).getTime() + 5000).toISOString();
  const leaseUpdate = await db.from("payment_webhook_inbox")
    .update({ lease_until: databaseLeaseUntil })
    .eq("id", insert.data.id)
    .eq("status", "PROCESSING")
    .eq("lease_owner", CRASHED_OWNER)
    .select("id,lease_until").single();
  if (leaseUpdate.error) throw new Error(`Database-clock lease update failed: ${leaseUpdate.error.message}`);

  const activeLeaseClaim = await db.rpc("claim_payment_webhook", {
    p_lease_owner: COMPETING_OWNER,
    p_lease_seconds: 60,
    p_max_attempts: 12
  });
  if (activeLeaseClaim.error) throw new Error(`Competing claim failed: ${activeLeaseClaim.error.message}`);
  const activeClaimRows = Array.isArray(activeLeaseClaim.data)
    ? activeLeaseClaim.data
    : activeLeaseClaim.data ? [activeLeaseClaim.data] : [];
  assert(activeClaimRows.length === 0, "A second worker claimed an event while its lease was active");

  const recovered = await waitForRecovery(db);
  assert(recovered.status === "PROCESSED", "Recovered event is not PROCESSED");
  assert(recovered.attempt_count === 2, "Expired lease was not reclaimed exactly once");
  assert(recovered.payment_intent_id === null, "Non-financial recovery event linked a PaymentIntent");
  assert(recovered.processed_at, "Recovered event has no processed timestamp");
  assert(recovered.lease_until === null, "Recovered event retained an active lease");

  const after = await readFinancialState(db);
  assert(after.intent.status === before.intent.status && after.intent.version === before.intent.version,
    "Lease recovery changed PaymentIntent state/version");
  assert(after.intent.provider_payment_id === before.intent.provider_payment_id && after.intent.paid_at === before.intent.paid_at,
    "Lease recovery changed captured-payment evidence");
  assert(after.order.payment_status === before.order.payment_status && after.order.paid_at === before.order.paid_at,
    "Lease recovery changed business-order financial state");
  assert(after.attemptCount === before.attemptCount, "Lease recovery created a financial attempt");

  console.log(JSON.stringify({
    result: "PASS",
    scenario: "Synthetic worker crash represented by active PROCESSING lease, followed by expiry recovery",
    eventId: EVENT_ID,
    activeLeaseProtected: true,
    recoveredStatus: recovered.status,
    attemptCountBeforeRecovery: 1,
    attemptCountAfterRecovery: recovered.attempt_count,
    processedTimestampPresent: !!recovered.processed_at,
    leaseCleared: recovered.lease_until === null,
    paymentIntentLinked: false,
    financialStateUnchanged: true,
    liveRazorpayUsed: false,
    newPaymentCreated: false
  }, null, 2));
}

main().catch((error) => {
  console.error(`TASK2B_WORKER_LEASE_RECOVERY_FAIL: ${error.message}`);
  process.exitCode = 1;
});
