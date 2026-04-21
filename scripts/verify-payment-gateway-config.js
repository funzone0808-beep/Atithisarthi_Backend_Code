require("dotenv").config({ path: ".env" });

const {
  getPaymentGatewayConfig,
  isPaymentGatewayConfigured,
  toGatewayMinorAmount
} = require("../utils/payment-gateway");

function main() {
  const config = getPaymentGatewayConfig();
  const configured = isPaymentGatewayConfigured();
  const sampleMinorAmount = toGatewayMinorAmount(491.25);

  console.log("Payment gateway config check complete.");
  console.log(`Provider: ${config.provider}`);
  console.log(`Currency: ${config.currency}`);
  console.log(`Enabled and configured: ${configured ? "yes" : "no"}`);
  console.log(`Sample amount conversion: 491.25 -> ${sampleMinorAmount}`);

  if (!configured) {
    console.log("Gateway routes will stay safely disabled until test keys are configured.");
  }
}

main();
