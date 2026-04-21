# Staff Billing Screen Runbook

Use this checklist before giving `staff-orders.html` to a hotel owner or trusted staff member.

## 1. Apply the staff access schema

In Supabase SQL editor, apply:

```sql
-- backend/scripts/create-hotel-staff-access-table.sql
```

Expected result:

- `public.hotel_staff_access` exists.
- It is separate from `admin_users`.
- It stores `pin_hash`, not plaintext PINs.

From `backend`, verify the schema with:

```powershell
npm run verify:staff-access
```

## 2. Create a hashed PIN

From `backend`, run:

```powershell
node scripts/hash-password.js 123456
```

Use a real PIN before sharing access. The output is a bcrypt hash.

## 3. Add one hotel-scoped staff credential

In Supabase SQL editor, insert one credential using the generated hash:

```sql
insert into public.hotel_staff_access (hotel_slug, display_name, role, pin_hash)
values (
  'hotel-example',
  'Example Owner',
  'owner',
  '$2b$10$replace_with_generated_hash'
);
```

Important:

- Use the exact hotel slug from your `hotels.slug` / `hotel_profiles.hotel_slug`.
- Do not paste the plaintext PIN into `pin_hash`.
- Create separate rows for separate hotels.

## 4. Login test

Open:

```text
http://127.0.0.1:5500/frontend/staff-orders.html?hotel=hotel-example
```

Expected result:

- Hotel slug is prefilled.
- Correct PIN logs in.
- Wrong PIN does not log in.
- Staff dashboard shows only the logged-in hotel slug.

## 5. Order list test

After login:

- Select `Today`.
- Select `Last 7 days`.
- Select `Recent`.
- Select `All recent`.

Expected result:

- Orders are shown only for the staff token hotel.
- Table number is visible when present.
- Order id, items, total, payment status, billing status, and created time are visible.

From `backend`, you can dry-run the staff billing read shape for one hotel with:

```powershell
npm run verify:staff-billing -- hotel-example
```

Expected result:

- Staff access schema is readable.
- Order table/billing/table columns are readable.
- No database writes are made.
- Recent orders are printed only for the selected hotel slug.

## 6. Billing action test

Use one safe test order first:

- Click `Mark Billed`.
- Confirm the browser prompt.
- Confirm the card refreshes and shows billed state.
- Click `Mark Paid`.
- Confirm the browser prompt.
- Confirm the card refreshes and shows paid state.

Expected result:

- The order remains in the same hotel list.
- Bill number appears after billing when the database billing columns are ready.
- Re-clicking an already billed/paid action should be disabled in the UI.

## 7. View bill test

Click `View Bill`.

Expected result:

- Printable bill opens in a new window.
- Bill shows hotel name, order id, table, items, quantities, totals, payment status, billing status, and note.
- Browser may require popups to be allowed for this page.

## 8. Tenant isolation test

Create two staff credentials:

- One for `hotel-example`.
- One for another hotel slug.

Login as each staff user and verify:

- Hotel A staff sees only Hotel A orders.
- Hotel B staff sees only Hotel B orders.
- Changing the `?hotel=` query param after login does not change the staff token hotel scope.
- Staff page never exposes the full admin dashboard.

## 9. Stop before wider access

Do not share this page publicly until:

- The staff access table exists.
- Each staff PIN is unique per hotel.
- At least one cross-hotel isolation test has passed.
- Normal public ordering, QR ordering, WhatsApp fallback, and full admin order view still work.
