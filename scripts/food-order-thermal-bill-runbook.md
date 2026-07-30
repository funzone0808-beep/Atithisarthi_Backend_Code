# Food Order Thermal Bill deployment runbook

## Scope

This release is additive. It does not replace the Orders route, existing bill
numbering, order totals, payment updates, KDS transitions, room checkout, or
room-service settlement.

## 1. Pre-deployment backup

Create a database backup or restore point using the normal Supabase production
backup process. Confirm the target project and environment before applying SQL.

## 2. Apply the migration

Run the complete contents of:

`backend/scripts/create-food-order-thermal-bill.sql`

in the target Supabase SQL Editor as a privileged database owner.

The migration creates only:

- `food_order_bill_formats`
- `food_order_bill_snapshots`
- `food_order_bill_audit`
- the immutable snapshot protection trigger/function
- hotel-scoped indexes, defaults, and service-role grants

It seeds one default format per existing `hotel_profiles.hotel_slug`.

## 3. Verify schema readiness

Run:

```powershell
cd backend
npm run verify:food-order-bill
```

Then verify through the authenticated owner workspace:

1. Open Orders.
2. Select a real hotel-scoped order.
3. Select View Bill.
4. Confirm a provisional bill is labelled provisional when the order is not
   billed.
5. Mark an order billed through the existing action.
6. Open View Bill and confirm an immutable snapshot is returned.
7. Change the Food Bill Format and confirm reprinting the old invoice retains
   its original branding and values.
8. Verify a second hotel cannot fetch the order ID, snapshot, logo, or format.

## 4. Print checks

Test both paper widths in browser print preview:

- 58mm, 2mm margin
- 80mm, 2mm margin

Confirm navigation, modal chrome, and action buttons do not print. Use the
Download PDF action and choose Save as PDF in the existing browser print
system.

## 5. Room-service checks

For one checked-in booking, verify:

- a separate food bill is not included in the room folio;
- a charge-to-room order remains `Pending Room Charge` before settlement;
- the existing combined checkout includes an eligible charge-to-room order
  once;
- a settled order shows `Transferred to Room Folio`;
- cancelled and payment-failed orders remain excluded.

## Rollback

First deploy the previous application build so no running instance calls the
new endpoints. Then run the complete contents of:

`backend/scripts/rollback-food-order-thermal-bill.sql`

The rollback drops only the new Food Bill Format, snapshot, and audit objects.
It does not change or delete orders, payments, KDS records, room bookings,
room-checkout receipts, or existing invoice numbers.

Export `food_order_bill_snapshots` and `food_order_bill_audit` before rollback
if issued bill history must be retained outside the database.
