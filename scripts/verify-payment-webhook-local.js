require("dotenv").config({ path: ".env" });

const crypto = require("crypto");

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function buildWebhookSignature(rawBody, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
}

async function postWebhook({ url, rawBody, signature, eventId }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Razorpay-Signature": signature,
      "X-Razorpay-Event-Id": eventId
    },
    body: rawBody
  });
  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function printResult(label, result) {
  console.log(`${label}: HTTP ${result.status}`);
  console.log(JSON.stringify(result.data, null, 2));
}

function normalizeTestEvent(value = "") {
  const event = String(value || "").trim().toLowerCase();

  if (["payment.captured", "transfer.processed", "transfer.failed"].includes(event)) {
    return event;
  }

  return "payment.captured";
}

function buildPaymentCapturedPayload() {
  return {
    event: "payment.captured",
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: `pay_local_smoke_${Date.now()}`,
          order_id: `order_local_smoke_${Date.now()}`,
          status: "captured",
          captured: true,
          amount: 100,
          currency: "INR"
        }
      }
    }
  };
}

function buildTransferPayload({ event, gatewayOrderId, transferId, linkedAccountId }) {
  const isFailed = event === "transfer.failed";

  return {
    event,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      transfer: {
        entity: {
          id: transferId,
          entity: "transfer",
          source: gatewayOrderId,
          recipient: linkedAccountId,
          amount: 100,
          currency: "INR",
          status: isFailed ? "failed" : "processed",
          transfer_status: isFailed ? "failed" : "processed",
          settlement_status: isFailed ? "pending" : "settled",
          error: isFailed
            ? {
                code: "local_test_failure",
                description: "Local transfer failure smoke test"
              }
            : null
        }
      }
    }
  };
}

function buildWebhookPayload({ event, gatewayOrderId, linkedAccountId }) {
  if (event === "payment.captured") {
    return buildPaymentCapturedPayload();
  }

  if (!gatewayOrderId || !gatewayOrderId.startsWith("order_")) {
    throw new Error(
      "WEBHOOK_TEST_GATEWAY_ORDER_ID=order_xxxxx is required for transfer webhook tests"
    );
  }

  return buildTransferPayload({
    event,
    gatewayOrderId,
    linkedAccountId: linkedAccountId || "acc_local_test",
    transferId: `trf_local_smoke_${Date.now()}`
  });
}

async function main() {
  const secret = getEnv("RAZORPAY_WEBHOOK_SECRET");
  const port = getEnv("PORT", "5000");
  const url = getEnv(
    "PAYMENT_WEBHOOK_TEST_URL",
    `http://localhost:${port}/api/payments/webhook`
  );
  const testEvent = normalizeTestEvent(getEnv("WEBHOOK_TEST_EVENT"));
  const gatewayOrderId = getEnv("WEBHOOK_TEST_GATEWAY_ORDER_ID");
  const linkedAccountId = getEnv("WEBHOOK_TEST_LINKED_ACCOUNT_ID", "acc_local_test");

  if (!secret) {
    console.log("Payment webhook local smoke test");
    console.log("--------------------------------");
    console.log("RAZORPAY_WEBHOOK_SECRET is missing in backend/.env.");
    console.log("Add the test webhook secret from Razorpay before running this check.");
    process.exit(1);
  }

  const eventId = `local-webhook-smoke-${testEvent}-${Date.now()}`;
  const payload = buildWebhookPayload({
    event: testEvent,
    gatewayOrderId,
    linkedAccountId
  });
  const rawBody = JSON.stringify(payload);
  const signature = buildWebhookSignature(rawBody, secret);

  console.log("Payment webhook local smoke test");
  console.log("--------------------------------");
  console.log(`Webhook URL: ${url}`);
  console.log(`Event type: ${testEvent}`);
  console.log(`Event id: ${eventId}`);
  if (testEvent === "payment.captured") {
    console.log("This uses a fake gateway order id, so it should not update any real order.");
  } else {
    console.log(`Transfer source order: ${gatewayOrderId}`);
    console.log(`Transfer recipient: ${linkedAccountId}`);
  }
  console.log("");

  const invalidResult = await postWebhook({
    url,
    rawBody,
    signature: "invalid_signature",
    eventId: `${eventId}-invalid`
  });
  printResult("Invalid signature check", invalidResult);

  if (invalidResult.status !== 400) {
    console.log("");
    console.log("Expected invalid signature request to return HTTP 400.");
    process.exit(1);
  }

  const firstResult = await postWebhook({
    url,
    rawBody,
    signature,
    eventId
  });
  printResult("Valid signed webhook check", firstResult);

  if (!firstResult.ok) {
    console.log("");
    console.log("Valid signed webhook did not pass. Check webhook table/env/backend logs.");
    process.exit(1);
  }

  const duplicateResult = await postWebhook({
    url,
    rawBody,
    signature,
    eventId
  });
  printResult("Duplicate webhook check", duplicateResult);

  if (!duplicateResult.ok || duplicateResult.data?.duplicate !== true) {
    console.log("");
    console.log("Expected duplicate signed webhook to be accepted as duplicate=true.");
    process.exit(1);
  }

  console.log("");
  console.log("Payment webhook local smoke test passed.");
}

main().catch((error) => {
  console.error(`Payment webhook local smoke test failed: ${error.message}`);
  process.exit(1);
});
