"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const {
  createAdminCombinedCheckoutContextResolver,
  createRoomCombinedCheckoutFeatureGate,
  createRoomCombinedCheckoutHandler,
  resolveStaffCombinedCheckoutContext
} = require("../utils/room-combined-checkout-handler");

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    }
  };
}

function createFakeClient() {
  return {
    async rpc() {
      throw new Error("Fake handler test must not call rpc directly");
    }
  };
}

function createFakeBookingClient(result) {
  const calls = [];
  const query = {
    select(columns) {
      calls.push({ method: "select", value: columns });
      return this;
    },
    eq(column, value) {
      calls.push({ method: "eq", column, value });
      return this;
    },
    async maybeSingle() {
      calls.push({ method: "maybeSingle" });
      return result;
    }
  };

  return {
    calls,
    from(table) {
      calls.push({ method: "from", value: table });
      return query;
    }
  };
}

async function main() {
  let enabledNextCount = 0;
  const disabledGate = createRoomCombinedCheckoutFeatureGate({
    isEnabled: () => false
  });
  const disabledGateRes = createResponseRecorder();
  disabledGate({}, disabledGateRes, () => {
    throw new Error("Disabled combined checkout gate must not call next");
  });
  assert.equal(disabledGateRes.statusCode, 503);
  assert.equal(disabledGateRes.payload.code, "combined_checkout_disabled");

  const enabledGate = createRoomCombinedCheckoutFeatureGate({
    isEnabled: () => true
  });
  enabledGate({}, createResponseRecorder(), () => {
    enabledNextCount += 1;
  });
  assert.equal(enabledNextCount, 1);
  const settlementCalls = [];
  const settleCheckout = async (payload) => {
    settlementCalls.push(payload);
    return {
      ok: true,
      status: 200,
      idempotentReplay: false,
      receipt: { id: 10 },
      booking: { id: 42, booking_status: "checked_out" },
      settledOrderCount: 2
    };
  };
  const handler = createRoomCombinedCheckoutHandler({
    supabaseClient: createFakeClient(),
    resolveRequestContext: resolveStaffCombinedCheckoutContext,
    settleCheckout
  });
  const req = {
    params: { id: "42" },
    validatedBody: {
      amount: 150,
      paymentMethod: "cash",
      idempotencyKey: "checkout-42",
      currency: "INR",
      hotelSlug: "attacker-hotel",
      paymentStatus: "paid"
    },
    staffHotelSlug: "trusted-hotel",
    staffRole: "manager",
    staffCanViewManagerData: true,
    staffUser: {
      sub: "staff-7",
      role: "manager",
      isManager: true
    }
  };
  const res = createResponseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.success, true);
  assert.equal(settlementCalls.length, 1);
  assert.equal(settlementCalls[0].hotelSlug, "trusted-hotel");
  assert.equal(settlementCalls[0].actorUserId, "staff-7");
  assert.equal(settlementCalls[0].actorRole, "manager");
  assert.equal("paymentStatus" in settlementCalls[0], false);

  const deniedRes = createResponseRecorder();
  await handler({
    params: { id: "42" },
    validatedBody: req.validatedBody,
    staffHotelSlug: "trusted-hotel",
    staffRole: "kitchen",
    staffUser: { role: "kitchen", isManager: false }
  }, deniedRes);
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.payload.code, "manager_access_required");
  assert.equal(settlementCalls.length, 1);

  const missingScopeHandler = createRoomCombinedCheckoutHandler({
    supabaseClient: createFakeClient(),
    resolveRequestContext: async () => ({ ok: true, actorRole: "admin" }),
    settleCheckout
  });
  const missingScopeRes = createResponseRecorder();
  await missingScopeHandler(req, missingScopeRes);
  assert.equal(missingScopeRes.statusCode, 403);
  assert.equal(missingScopeRes.payload.code, "hotel_scope_missing");
  assert.equal(settlementCalls.length, 1);

  const conflictHandler = createRoomCombinedCheckoutHandler({
    supabaseClient: createFakeClient(),
    resolveRequestContext: async () => ({
      ok: true,
      hotelSlug: "trusted-hotel",
      actorRole: "admin"
    }),
    settleCheckout: async () => ({
      ok: false,
      status: 409,
      schemaReady: true,
      retryable: true,
      code: "checkout_conflict",
      message: "Reload and retry"
    })
  });
  const conflictRes = createResponseRecorder();
  await conflictHandler(req, conflictRes);
  assert.equal(conflictRes.statusCode, 409);
  assert.equal(conflictRes.payload.code, "checkout_conflict");
  assert.equal(conflictRes.payload.retryable, true);

  const invalidHandler = createRoomCombinedCheckoutHandler({
    supabaseClient: createFakeClient(),
    resolveRequestContext: async () => ({
      ok: true,
      hotelSlug: "trusted-hotel"
    }),
    settleCheckout: async () => {
      throw new TypeError("Booking id must be a positive integer");
    }
  });
  const invalidRes = createResponseRecorder();
  await invalidHandler({ params: { id: "bad" }, validatedBody: req.validatedBody }, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.payload.code, "checkout_request_invalid");

  const replayHandler = createRoomCombinedCheckoutHandler({
    supabaseClient: createFakeClient(),
    resolveRequestContext: async () => ({
      ok: true,
      hotelSlug: "trusted-hotel"
    }),
    settleCheckout: async () => ({
      ok: true,
      idempotentReplay: true,
      receipt: { id: 10 },
      booking: { id: 42 },
      settledOrderCount: 2
    })
  });
  const replayRes = createResponseRecorder();
  await replayHandler(req, replayRes);
  assert.equal(replayRes.statusCode, 200);
  assert.equal(replayRes.payload.idempotentReplay, true);

  const adminBookingClient = createFakeBookingClient({
    data: {
      id: 42,
      hotel_slug: "stored-hotel"
    },
    error: null
  });
  const resolveAdminContext = createAdminCombinedCheckoutContextResolver({
    supabaseClient: adminBookingClient
  });
  const adminContext = await resolveAdminContext({
    params: { id: "42" },
    validatedBody: { hotelSlug: "attacker-hotel" },
    adminUser: {
      sub: "admin-1",
      scope: "admin"
    }
  });
  assert.deepEqual(adminContext, {
    ok: true,
    hotelSlug: "stored-hotel",
    actorUserId: "admin-1",
    actorRole: "admin"
  });
  assert.deepEqual(adminBookingClient.calls, [
    { method: "from", value: "room_bookings" },
    { method: "select", value: "id,hotel_slug" },
    { method: "eq", column: "id", value: "42" },
    { method: "maybeSingle" }
  ]);

  const invalidAdminClient = createFakeBookingClient({ data: null, error: null });
  const invalidAdminContext = await createAdminCombinedCheckoutContextResolver({
    supabaseClient: invalidAdminClient
  })({ params: { id: "bad" } });
  assert.equal(invalidAdminContext.status, 400);
  assert.equal(invalidAdminClient.calls.length, 0);

  const missingAdminContext = await createAdminCombinedCheckoutContextResolver({
    supabaseClient: createFakeBookingClient({ data: null, error: null })
  })({ params: { id: "404" } });
  assert.equal(missingAdminContext.status, 404);
  assert.equal(missingAdminContext.code, "booking_not_found");

  const schemaAdminContext = await createAdminCombinedCheckoutContextResolver({
    supabaseClient: createFakeBookingClient({
      data: null,
      error: { code: "42P01", message: "room_bookings does not exist" }
    })
  })({ params: { id: "42" } });
  assert.equal(schemaAdminContext.status, 503);
  assert.equal(schemaAdminContext.code, "checkout_schema_unavailable");

  const invalidScopeContext = await createAdminCombinedCheckoutContextResolver({
    supabaseClient: createFakeBookingClient({
      data: { id: 42, hotel_slug: "" },
      error: null
    })
  })({ params: { id: "42" } });
  assert.equal(invalidScopeContext.status, 500);
  assert.equal(invalidScopeContext.code, "checkout_data_invalid");

  const backendRoot = path.resolve(__dirname, "..");
  const adminRoute = fs.readFileSync(path.join(backendRoot, "routes", "admin-room-booking.js"), "utf8");
  const staffRoute = fs.readFileSync(path.join(backendRoot, "routes", "staff-room-booking.js"), "utf8");
  assert.match(adminRoute, /room-combined-checkout-handler/);
  assert.match(staffRoute, /room-combined-checkout-handler/);
  assert.match(
    adminRoute,
    /"\/bookings\/:id\/combined-checkout",\s*requireAdminCombinedBilling,\s*requireRoomCombinedCheckoutEnabled,\s*validateBody\(roomCombinedCheckoutSchema\),\s*adminRoomCombinedCheckoutHandler/m
  );
  assert.match(
    staffRoute,
    /"\/bookings\/:id\/combined-checkout",\s*requireStaffManagerAccess,\s*requireStaffCombinedBilling,\s*requireRoomCombinedCheckoutEnabled,\s*validateBody\(roomCombinedCheckoutSchema\),\s*staffRoomCombinedCheckoutHandler/m
  );

  console.log("Combined checkout HTTP handler verification passed.");
  console.log("Verified trusted staff scope, manager denial, disabled gate, response statuses, retries, idempotent replay, and invalid requests.");
  console.log("Verified body tenant/payment-state fields are not forwarded and admin/staff checkout routes are guarded.");
  console.log("No database or network access was used.");
}

main().catch((error) => {
  console.error(`Combined checkout HTTP handler verification failed: ${error.message}`);
  process.exit(1);
});