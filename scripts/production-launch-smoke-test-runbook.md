# Production Launch Smoke Test Runbook

Use this checklist before giving the platform to a real hotel client.

Run it after production environment values are set and before sharing public, admin, or staff links.

## 1. Confirm production config

From `backend`, run:

```powershell
npm.cmd run verify:production-config
```

Expected result:

- The command exits successfully.
- `NODE_ENV` is production.
- `FRONTEND_URL` and `ADMIN_URL` are HTTPS URLs.
- `SUPABASE_URL` is HTTPS.
- `JWT_SECRET` is strong and not a placeholder.
- If online payment is enabled, live Razorpay keys and webhook secret are configured.

Stop if this check fails.

## 2. Confirm database feature schemas

From `backend`, run:

```powershell
npm.cmd run verify:billing-schema
npm.cmd run verify:payment-gateway-schema
npm.cmd run verify:staff-access
```

Expected result:

- Billing columns are ready.
- Payment gateway columns are ready.
- Staff access table is ready.

If any command reports a missing table or column, apply the matching SQL file from `backend/scripts` before continuing.

## 3. Confirm payment readiness

If secure online payment is enabled, run:

```powershell
npm.cmd run verify:payment-gateway-readiness
```

Expected result:

- Payment schema is ready.
- Webhook event table is ready.
- Backend gateway keys are configured.
- Webhook secret is configured.
- Frontend gateway flags match backend readiness.

Also open:

```text
/api/payments/readiness
```

Expected result:

- `paymentGateway.checkoutAvailable` is true only when production webhook requirements are ready.
- `paymentGateway.reason` is `ready`.

Stop if payment readiness fails and online payment is meant to be live.

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
- WhatsApp opens after successful verified payment.
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
- No mixed-content warnings for API or uploaded media.
- Backend health endpoint responds.
- Admin login works.
- Staff login works.
- Public WhatsApp fallback still opens if backend save fails during a controlled test.
- Payment gateway is disabled if webhook is not fully tested.

## 17. Launch decision

Launch only if:

- Production config check passes.
- Required schema checks pass.
- Public order flow works.
- QR order flow works if QR is being given to the hotel.
- Payment readiness and webhook test pass if online payment is enabled.
- Admin and staff panels both work.
- Tenant isolation test passes.

If any critical check fails, fix it before giving the link to a real client.
