# Dine-in Billing Runbook

Use this checklist before relying on QR table billing in daily operations.

## 1. Confirm the schema and dry run

From `backend`, run:

```powershell
npm run verify:billing-schema
npm run verify:dine-in-billing
```

Expected result:

- Billing columns are ready.
- The dine-in billing dry run says no database writes were made.
- Recent QR/table orders are listed if any exist.

## 2. Place one QR table test order

Use a verified QR table link from `qr-table-ordering-runbook.md`.

Place one small test order and check the admin orders list:

- The Orders tab shows a Dine-in Billing summary card when table orders are present.
- The summary card counts Not billed, Billed not paid, Verify UPI, and Paid orders.
- Order type shows dine-in.
- Table shows the expected table label.
- Payment Status shows unpaid, unless the customer selected and confirmed UPI.
- If it shows customer confirmed, verify before paid, treat it as a customer signal only.
- Billing Status shows not_billed.
- If the order needs review, the order card shows a Payment Attention row.
- Normal non-QR orders are unchanged.

## 3. Mark the order billed

In the admin order card:

- Set Billing Status to billed.
- Keep Payment Status as unpaid unless payment was actually received.
- If Payment Status says customer confirmed, verify before paid, do not treat it as paid yet.
- Click Update Billing.
- Confirm the browser prompt only after checking the selected Billing Status and Payment Status.

Expected result:

- Billing Status shows billed.
- A Bill Number appears.
- Billed At appears.
- If payment is still unpaid or customer-confirmed only, the Payment Attention row remains visible.
- View Bill opens a printable bill with the same hotel, table, items, totals, and note.

## 4. Mark payment received

After the counter/operator confirms payment:

- Set Payment Status to paid.
- Click Update Billing.
- Confirm the browser prompt only after payment is verified.

Expected result:

- Payment Status shows paid.
- Paid At appears.
- Payment Attention disappears for that order.
- The printable bill still shows the same Bill Number.

Important rule:

- Only the operator should set Payment Status to paid.
- customer confirmed, verify before paid means the customer checked the UPI confirmation box, not that the hotel verified receipt.
- The dry-run verifier counts customer confirmed, verify before paid as billed but unpaid until the operator marks paid.

## 5. If billing is reverted

If an operator changes Billing Status back to not_billed:

- The saved bill reference is preserved.
- Admin shows it as Saved Bill Ref, not active Bill Number.
- This keeps history visible until a fuller audit table exists.

## 6. Stop here before adding customer-side payment

Do not add a forced customer-side pay-now step until this operator flow is stable:

- QR order is saved.
- WhatsApp order still reaches the owner.
- Admin can mark billed.
- Admin can mark paid.
- Printable bill matches the saved order.
