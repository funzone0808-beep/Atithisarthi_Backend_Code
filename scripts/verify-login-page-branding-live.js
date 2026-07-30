"use strict";

const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const { signAdminToken, signStaffToken } = require("../utils/auth");
const { PUBLIC_LOGIN_BRANDING_KEYS } = require("../utils/login-branding");

const port = 5057;
const apiBase = `http://127.0.0.1:${port}/api`;
let serverOutput = "";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const result = await fetchJson(`${apiBase}/public/login-branding`);
      if (result.response.status > 0) return result;
    } catch {
      await delay(200);
    }
  }
  throw new Error(`Local server did not start. ${serverOutput.slice(-500)}`);
}

async function main() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

  try {
    const initial = await waitForServer();
    assert.strictEqual(initial.response.status, 200, "Public branding fallback must stay available");
    assert.strictEqual(initial.body.success, true);
    assert.deepStrictEqual(Object.keys(initial.body.branding || {}), [...PUBLIC_LOGIN_BRANDING_KEYS]);
    assert(!("draftConfig" in initial.body));
    assert(!("id" in initial.body));
    assert(!("audit" in initial.body));

    const invalidSlug = await fetchJson(`${apiBase}/public/login-branding?hotelSlug=..%2Fsecret`);
    assert.strictEqual(invalidSlug.response.status, 400, "Invalid public hotel slug must be rejected");

    const unknownHotel = await fetchJson(`${apiBase}/public/login-branding?hotelSlug=unknown-hotel`);
    assert.strictEqual(unknownHotel.response.status, 200, "Unknown hotel branding must safely fall back");
    assert.strictEqual(unknownHotel.body.success, true);

    const unauthenticated = await fetchJson(`${apiBase}/admin/login-branding?scopeType=platform`);
    assert.strictEqual(unauthenticated.response.status, 401, "Unauthenticated Admin branding access must be rejected");

    const staffToken = signStaffToken({
      id: "branding-security-test-staff",
      hotel_slug: "security-test-hotel",
      display_name: "Security Test",
      role: "owner"
    });
    const staffAttempt = await fetchJson(`${apiBase}/admin/login-branding?scopeType=platform`, {
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert.strictEqual(staffAttempt.response.status, 401, "Staff and hotel-owner tokens must not access Admin branding");

    const adminToken = signAdminToken({
      id: "branding-security-test-admin",
      email: "branding-test@example.invalid",
      full_name: "Branding Test"
    });
    const adminAttempt = await fetchJson(`${apiBase}/admin/login-branding?scopeType=platform`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      [200, 503].includes(adminAttempt.response.status),
      `Platform Admin should pass authorization; received ${adminAttempt.response.status}`
    );
    if (adminAttempt.response.status === 503) {
      assert(/not initialized/i.test(adminAttempt.body.message || ""), "Missing migration must return a safe Admin error");
    }

    const emptyLogin = await fetchJson(`${apiBase}/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.strictEqual(emptyLogin.response.status, 400, "Existing Staff login validation must remain active");
    assert(!JSON.stringify(emptyLogin.body).includes("stack"), "Login validation response exposed a stack trace");

    console.log("Live Login Page Branding HTTP verification passed.");
    console.log(`Public fallback: 200; invalid slug: 400; unauthenticated Admin: 401; Staff token on Admin: 401; Platform Admin storage response: ${adminAttempt.response.status}.`);
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(`Live Login Page Branding HTTP verification failed: ${error.message || error}`);
  process.exitCode = 1;
});
