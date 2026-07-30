# Production Launch Smoke Test Runbook

Use this checklist before giving the platform to a real hotel client.

Run it after production environment values are set and before sharing public, admin, or staff links.

## 0. Secret and environment sanity check

Before anything else:

- Confirm production secrets are not copied from an old local `.env` without review.
- If this workspace, repo, or screenshots/logs were ever shared, rotate:
  - `JWT_SECRET`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`
  - SMTP credentials
- Use [`.env.production.example`](C:/Users/admin/Desktop/project2/backend/.env.production.example) as the production template, not the local development example.
- If more than one hotel public domain will be live, set `FRONTEND_ORIGINS` as a comma-separated HTTPS list.

## 1. Confirm production config

From `backend`, run:

```powershell
npm.cmd run prepare:frontend-runtime-config
npm.cmd run verify:frontend-runtime-config
npm.cmd run verify:production-config
```

Expected result:

- The frontend HTML pages are stamped with the intended production runtime URLs.
- `verify:frontend-runtime-config` passes.
- The command exits successfully.
- `NODE_ENV` is production.
- `FRONTEND_URL` and `ADMIN_URL` are HTTPS URLs.
- `APP_BACKEND_BASE_URL` and `APP_API_BASE_URL` are HTTPS URLs.
- `APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE` is explicitly set to `true` or `false`.
- `APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT` is explicitly set to `true` or `false`.
- `SUPABASE_URL` is HTTPS.
- `JWT_SECRET` is strong and not a placeholder.
- If online payment is enabled, live Razorpay keys and webhook secret are configured.

Recommended for first real-client launch:

- Set `APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE=false` so normal website orders do not bypass DB, tracking, and staff workflows when backend save fails.
- Set `APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT=true` if secure online payment is live and the hotel still relies on WhatsApp as the primary operating handoff.

Stop if this check fails.

## 2. Confirm database feature schemas

From `backend`, run:

```powershell
npm.cmd run verify:billing-schema
npm.cmd run verify:payment-gateway-schema
npm.cmd run verify:payment-gateway-ids
npm.cmd run verify:staff-access
npm.cmd run verify:staff-billing-permissions
npm.cmd run verify:tenant-domain-trust
```

Expected result:

- Billing columns are ready.
- Payment gateway columns are ready.
- Existing `gateway_order_id` and `gateway_payment_id` values are unique.
- Staff access table is ready.
- Staff billed/paid actions are still protected as manager-only actions.
- Tenant/domain trust still routes public and subdomain access through the shared trusted-host checks.

Important tenant note:

- If shared subdomain routing is part of the launch plan, make sure `FRONTEND_URL` and `FRONTEND_ORIGINS` include the real HTTPS public domain family before running this check.

If any command reports a missing table or column, apply the matching SQL file from `backend/scripts` before continuing.

If `verify:payment-gateway-ids` passes and secure online payment is enabled, apply this hardening script in Supabase SQL editor during a low-traffic window:

```sql
-- backend/scripts/add-order-payment-gateway-unique-indexes.sql
```

Expected result:

- New duplicate gateway ids are blocked at the database layer.
- Normal payment flow still works unchanged for valid requests.

## 3. Confirm payment readiness

If secure online payment is enabled, run:

```powershell
npm.cmd run verify:payment-gateway-readiness
npm.cmd run verify:first-client-launch-profile
```

Expected result:

- Payment schema is ready.
- Webhook event table is ready.
- Backend gateway keys are configured.
- Webhook secret is configured.
- Frontend gateway flags match backend readiness.
- Gateway ids are protected against duplicate inserts if the unique-index script has been applied.

Also open:

```text
/api/payments/readiness
```

Expected result:

- `paymentGateway.checkoutAvailable` is true only when production webhook requirements are ready.
- `paymentGateway.reason` is `ready`.

Stop if payment readiness fails and online payment is meant to be live.

## 3a. Room combined checkout production gate

Keep `ROOM_COMBINED_CHECKOUT_ENABLED=false` and `ROOM_COMBINED_CHECKOUT_FRONTEND_ENABLED=false` for production unless the staging-only combined checkout runbook has passed and production enablement is separately approved.

Before enabling `ROOM_COMBINED_CHECKOUT_ENABLED=true` in any production environment, confirm:

```powershell
npm.cmd run verify:room-checkout-runbook
npm.cmd run verify:room-checkout-production-flags
npm.cmd run verify:room-checkout-preflight
npm.cmd run verify:room-checkout-migration
```

Also confirm `room-combined-checkout-staging-runbook.md` has been completed against a staging database, including `verify:room-checkout-staging` with `ROOM_CHECKOUT_STAGING_VERIFY="I_UNDERSTAND_STAGING_ONLY"`.

Expected result:

- The production backend and frontend remain disabled by default until staging is signed off and production enablement is separately approved.
- The frontend-only production flag combination is blocked before any operator can see enabled combined checkout controls.
- Admin and staff combined checkout buttons remain disabled in production unless both production flags are explicitly approved.
- Food ordering, QR ordering, KDS, billing, admin login, staff login, and tenant isolation are smoke-tested after staging checkout verification.

Stop if the staging runbook has not passed. Do not enable production combined checkout from this launch checklist alone.

## 4. Public homepage smoke test

Open the production homepage for one hotel.

Expected result:

- Loading screen finishes cleanly.
- Correct hotel name, profile content, theme, hero, about images, gallery, testimonials, and contact details appear.
- Navbar section visibility matches the hotel settings.
- Browser console has no blocking app bootstrap errors.
- Network calls use the production API URL, not localhost.

Repeat once with a second hotel slug/domain if available.

## 5. Full menu page smoke test

Open the production menu page for the same hotel.

Expected result:

- Full menu loads for the correct hotel.
- Search, category tabs, filters, and load-more behavior work if present.
- Cart count updates.
- Cart is hotel-scoped and does not leak from another hotel.
- `View Full Menu` links preserve the hotel slug.

## 6. Normal website order smoke test

Place one small COD test order from the public website.

Expected result:

- Backend saves the order.
- WhatsApp opens with the correct hotel, customer, items, quantities, totals, note, and payment method.
- Saved order totals match backend menu prices, not any browser-tampered values.
- Admin Orders shows the order.
- Staff panel Orders shows the order only for that hotel.

Policy note:

- If `APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE=false`, a simulated backend save failure should stop before WhatsApp opens and should tell the user to retry because the order was not saved.
- If `APP_ALLOW_ORDER_WHATSAPP_FALLBACK_ON_SAVE_FAILURE=true`, a simulated backend save failure may still open WhatsApp, but the UI should clearly say this became a WhatsApp-only order with no tracking.

## 7. QR table order smoke test

Use `qr-table-ordering-runbook.md` for one table QR link.

Expected result:

- QR URL opens the correct hotel and table.
- Checkout shows dine-in/table context.
- Address is not required for dine-in table order.
- WhatsApp message includes table number and QR/source context.
- Admin and staff panel show table number and source.
- Billing state starts in the expected unpaid/not billed state.

## 8. Secure online payment smoke test

Only run this when the production gateway is intentionally enabled.

Place one low-value secure online payment test order.

Expected result:

- Payment checkout opens.
- Backend creates a pending local order.
- After payment success, backend verification marks the order paid.
- If `APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT=true`, WhatsApp opens after successful verified payment with the paid order summary.
- If `APP_OPEN_WHATSAPP_AFTER_VERIFIED_ONLINE_PAYMENT=false`, do not treat the payment flow as ops-complete unless another tested live hotel-facing handoff exists.
- Admin and staff panel show paid/payment gateway status.
- Webhook event later reaches `/api/payments/webhook` and is processed idempotently.

If browser verification succeeds but webhook does not arrive, do not call the payment flow fully production-ready.

## 9. Reservation smoke test

Submit one reservation from the public site.

Expected result:

- Reservation saves in DB.
- WhatsApp or configured notification path still works as expected.
- Admin Reservations shows the record.
- Staff panel Reservations shows the record only for that hotel.
- Admin and staff status update controls work with allowed statuses only.

## 10. Inquiry smoke test

Submit one inquiry/event form from the public site.

Expected result:

- Inquiry saves in DB.
- Admin Inquiries shows the record.
- Staff panel Inquiries shows the record only for that hotel.
- Admin and staff status update controls work with allowed statuses only.

## 11. Testimonial smoke test

Submit one public review/testimonial.

Expected result:

- Review belongs to the current hotel.
- Review does not appear publicly until the current approval/active rules allow it.
- Admin Testimonials can approve, edit, archive, restore, and delete according to the existing flow.
- Public Testimonials section shows only approved active records for that hotel.

## 12. Admin upload smoke test

Login to admin and upload one safe image.

Expected result:

- JPG, PNG, WebP, or AVIF upload succeeds.
- SVG upload is rejected.
- Oversized files are rejected.
- Storage path is sanitized.
- Public URL can be pasted into gallery/profile/about image fields.
- Public page renders the uploaded image over HTTPS.

## 13. Staff owner panel smoke test

Use `staff-billing-runbook.md`.

Expected result:

- Staff login works with the correct hotel slug and PIN.
- Wrong PIN fails.
- Staff sees only that hotel's orders, reservations, and inquiries.
- Dashboard summary appears first.
- Orders, Reservations, and Inquiries show one section at a time.
- Mark Billed, Mark Paid, View Bill, and reservation/inquiry status updates still work.
- Changing the `?hotel=` query param does not change staff token scope.

## 14. Billing smoke test

Use `dine-in-billing-runbook.md`.

Expected result:

- Dine-in order can be marked billed.
- Bill number is generated.
- View Bill opens a printable bill.
- Payment can be marked paid only after operator confirmation.
- Staff and admin billing views stay consistent.

## 15. Tenant isolation smoke test

Use at least two hotel slugs if available.

Expected result:

- Hotel A public page shows Hotel A content.
- Hotel B public page shows Hotel B content.
- Hotel A cart does not appear on Hotel B.
- Hotel A staff login cannot see Hotel B orders, reservations, or inquiries.
- Hotel B staff login cannot see Hotel A records.
- Admin can still filter and manage both hotels internally.

## 16. Final browser and operations check

Before sharing links, check:

- No console errors block app startup.
- No API request points to `localhost`.
- Frontend runtime meta tags point to the intended production backend/API URLs.
- No mixed-content warnings for API or uploaded media.
- Backend health endpoint responds.
- Admin login works.
- Staff login works.
- Public WhatsApp fallback still opens if backend save fails during a controlled test.
- Payment gateway is disabled if webhook is not fully tested.

If runtime values were stamped directly into the workspace files during deployment prep and you do not want those environment-specific values kept in version control afterward, return the frontend pages to neutral placeholders:

```powershell
npm.cmd run reset:frontend-runtime-config
npm.cmd run verify:frontend-runtime-config-neutral
```

## 17. Launch decision

Launch only if:

- Production config check passes.
- Required schema checks pass.
- Public order flow works.
- QR order flow works if QR is being given to the hotel.
- Payment readiness and webhook test pass if online payment is enabled.
- Room combined checkout backend and frontend flags remain disabled unless the staging-only runbook has passed and production enablement is explicitly approved.
- Admin and staff panels both work.
- Tenant isolation test passes.

If any critical check fails, fix it before giving the link to a real client.
