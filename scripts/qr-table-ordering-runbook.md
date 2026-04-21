# QR Table Ordering Runbook

Use this checklist before printing or sharing a table QR code.

## 1. Generate the link

Open the admin dashboard and use **QR Table Link**.

Use:

- Hotel slug: the tenant slug, for example `hotel-example`
- Table number: the printed table label, for example `T5`
- Landing page: `Full Menu Page`

Expected URL shape:

```text
menu.html?hotel=hotel-example&table=T5&source=qr
```

If you choose the homepage landing page, it must include `#menu`:

```text
index.html?hotel=hotel-example&table=T5&source=qr#menu
```

## 2. Verify the link

From `backend`, run:

```powershell
npm run verify:qr-link -- "menu.html?hotel=hotel-example&table=T5&source=qr"
```

The verifier should print the hotel, table, source, and page.

## 3. Test before printing

Open the generated link and check:

- The correct hotel loads.
- The checkout shows the dine-in QR table notice.
- Adding an item does not ask for delivery location.
- The cart is separate from normal website orders.
- The WhatsApp preview includes hotel, table, items, totals, payment method, and note.
- WhatsApp opens the correct hotel owner number.

## 4. Confirm saved order

After placing one test order, check the admin orders list:

- Order type shows dine-in.
- Table shows the printed table label.
- Source shows qr.
- Normal non-QR orders still do not show table fields.

## 5. Only then print

Print one QR code per physical table. If a table label changes, generate and verify a fresh link before printing.
