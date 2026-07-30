"use strict";

const assert = require("assert").strict;
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const { signAdminToken, signStaffToken } = require("../utils/auth");

const port = 5059;
const apiBase = `http://127.0.0.1:${port}/api`;

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
      const result = await fetchJson(`${apiBase}/health`);
      if (result.response.status > 0) return;
    } catch {
      await delay(200);
    }
  }

  throw new Error("Local Admin verification server did not start");
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function assertNotHotelScopeFailure(result, label) {
  assert.notStrictEqual(
    result.body?.code,
    "HOTEL_SCOPE_REQUIRED",
    `${label} still requires one hotel in platform-wide mode`
  );
  assert.notStrictEqual(
    result.body?.message,
    "Hotel scope is required",
    `${label} still returns the hotel-scope failure`
  );
}

async function main() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: "ignore",
    windowsHide: true
  });

  try {
    await waitForServer();

    const adminToken = signAdminToken({
      id: "admin-platform-access-test",
      email: "admin-platform-access@example.invalid",
      full_name: "Admin Platform Access Test"
    });
    const staffToken = signStaffToken({
      id: "staff-platform-isolation-test",
      hotel_slug: "staff-isolation-hotel",
      display_name: "Staff Isolation Test",
      role: "owner"
    });

    const endpoints = [
      ["Orders", "/admin/orders"],
      ["Reservations", "/admin/reservations"],
      ["Inquiries", "/admin/inquiries"],
      ["Contact messages", "/admin/contact-submissions"],
      ["Notifications", "/admin/notification-events"],
      ["Hotels", "/admin/hotels"],
      ["Room types", "/admin/room-booking/room-types"],
      ["Rooms", "/admin/room-booking/rooms"],
      ["Room bookings", "/admin/room-booking/bookings"],
      ["Menu items", "/admin/menu-items"],
      ["Combo offers", "/admin/menu-combos"],
      ["Gallery items", "/admin/gallery-items"],
      ["Popup notifications", "/admin/popup-notifications"],
      ["Testimonials", "/admin/testimonials"]
    ];

    for (const [label, endpoint] of endpoints) {
      const unauthenticated = await fetchJson(`${apiBase}${endpoint}`);
      assert.strictEqual(unauthenticated.response.status, 401, `${label} must require Admin authentication`);

      const staffAttempt = await fetchJson(`${apiBase}${endpoint}`, {
        headers: authHeaders(staffToken)
      });
      assert.strictEqual(staffAttempt.response.status, 401, `${label} must reject Staff tokens`);

      const allHotels = await fetchJson(`${apiBase}${endpoint}`, {
        headers: authHeaders(adminToken)
      });
      assertNotHotelScopeFailure(allHotels, label);
      assert.strictEqual(
        allHotels.response.status,
        200,
        `${label} must load in platform-wide mode`
      );
    }

    const hotelsResult = await fetchJson(`${apiBase}/admin/hotels`, {
      headers: authHeaders(adminToken)
    });
    assert.strictEqual(hotelsResult.response.status, 200, "Admin hotel list must load");

    const selectedHotel = (hotelsResult.body.hotels || []).find((hotel) => hotel?.slug);
    if (selectedHotel) {
      const selectedName = encodeURIComponent(selectedHotel.name || selectedHotel.slug);
      const selectedSlug = encodeURIComponent(selectedHotel.slug);
      const selectedEndpoints = [
        `/admin/orders?hotelSlug=${selectedSlug}`,
        `/admin/reservations?hotelSlug=${selectedSlug}`,
        `/admin/inquiries?hotelName=${selectedName}`,
        `/admin/contact-submissions?hotelSlug=${selectedSlug}`,
        `/admin/notification-events?hotelSlug=${selectedSlug}`,
        `/admin/room-booking/room-types?hotelSlug=${selectedSlug}`,
        `/admin/room-booking/rooms?hotelSlug=${selectedSlug}`,
        `/admin/room-booking/bookings?hotelSlug=${selectedSlug}`,
        `/admin/menu-items?hotelSlug=${selectedSlug}`,
        `/admin/menu-combos?hotelSlug=${selectedSlug}`,
        `/admin/gallery-items?hotelSlug=${selectedSlug}`,
        `/admin/popup-notifications?hotelSlug=${selectedSlug}`,
        `/admin/testimonials?hotelSlug=${selectedSlug}`
      ];

      for (const endpoint of selectedEndpoints) {
        const selectedResult = await fetchJson(`${apiBase}${endpoint}`, {
          headers: authHeaders(adminToken)
        });
        assertNotHotelScopeFailure(selectedResult, endpoint);
        assert.strictEqual(
          selectedResult.response.status,
          200,
          `${endpoint} must load for an explicit hotel filter`
        );
      }
    }

    console.log("Live Admin platform access HTTP verification passed.");
    console.log("Verified every Admin panel tab in all-hotel and selected-hotel modes without exposing response data.");
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(`Live Admin platform access HTTP verification failed: ${error.message || error}`);
  process.exitCode = 1;
});
