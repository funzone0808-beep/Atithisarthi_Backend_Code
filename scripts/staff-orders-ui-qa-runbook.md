# Staff Orders UI Production QA Runbook

Use this runbook only in an approved local, staging, or disposable test environment. Do not use real guest data, production payment credentials, or permanent staff PINs.

## 1. Required test environment

Prepare two isolated test hotels:

- Hotel A with one disposable owner account and one disposable basic staff account.
- Hotel B with one disposable owner account and one disposable basic staff account.

Enable only modules that the tenant is expected to use. Record the served frontend URL and backend/API URL used for the test without committing secrets.

Run the offline guards first:

```powershell
cd backend
npm.cmd run verify:staff-orders-ui
npm.cmd run verify:staff-orders-release
npm.cmd run verify:frontend-runtime-config-source-safe
npm.cmd run verify:staff-billing-permissions
npm.cmd run verify:staff-reports
npm.cmd run verify:staff-table-ordering
npm.cmd run verify:staff-take-order-home
npm.cmd run verify:staff-active-table-ordering
npm.cmd run verify:staff-rate-limits
npm.cmd run verify:staff-take-order-responsive
npm.cmd run verify:staff-take-order-regressions
npm.cmd run verify:menu-combos
npm.cmd run verify:tenant-domain-trust
```

Do not continue if a verifier fails unexpectedly.

## 2. Disposable order fixtures

Create hotel-scoped records through the existing application flows, not direct frontend object injection:

- One website order.
- One QR table order.
- One staff-assisted table order.
- One room-service order linked to a checked-in booking.
- One parent table order with at least one add-on order.
- One order in each normal status: `new`, `confirmed`, `preparing`, `completed`, and `cancelled`.
- One verified paid order.
- One unpaid order.
- One billed order and one unbilled order.
- One `payment_pending` order through the payment flow.
- One `payment_failed` order through the payment flow.
- One order with a long customer name, long item name, long note, and a large amount.
- A menu with 100-150 available items across several categories, including at least one unavailable item and one time-windowed combo.

Never create `payment_pending` or `payment_failed` by changing the Staff Orders status control. Those states belong to the payment flow.

## 3. Role and financial-visibility checks

### Owner/manager session

Verify:

- Operational summary includes authorized payment and loaded-order-value cards.
- Order totals and item prices are visible.
- Payment method, bill number, and View Bill are available when data exists.
- Mark billed, mark paid, family billed, and family paid actions appear when valid.
- Source-group financial metrics are visible.
- Reports remain available.

### Basic staff session

Verify both the rendered UI and the `/api/staff/orders` and `/api/staff/kds/orders` response bodies:

- `financialsVisible` is `false`.
- `totals` is an empty object.
- Item price, amount, total, discount, savings, tax, GST, and cost fields are absent recursively.
- Payment method, bill number, billed timestamp, paid timestamp, and route-transfer metadata are absent or empty.
- Order totals, item prices, source financial metrics, View Bill, and money-state buttons are not rendered.
- Order IDs, item names, quantities, table/room context, notes, customer context, status, and KDS actions remain usable.
- Reports and manager-only dashboard summaries remain unavailable.

## 4. Source and status checks

Verify that All Sources contains separate visible groups for:

- QR Table Orders
- Staff Table Orders
- Room Service Orders
- Website Orders

Apply each source filter and confirm that no other source remains visible.

Verify status counts and filtering for:

- Received
- Confirmed
- Preparing
- Completed
- Cancelled
- Payment pending
- Payment failed

For `payment_pending` and `payment_failed` orders:

- The gateway-controlled explanation is visible.
- The current exceptional status is displayed, not Received.
- The operational status selector and update button are disabled.
- Payment flow resolution remains responsible for the next state.

## 5. Order-card and action checks

For each source and role:

- Confirm collapsed cards show only operational quick facts.
- Expand full details with mouse and keyboard.
- Confirm item names, quantities, notes, customer information, room/table context, and staff attribution remain correct.
- Leave a card expanded and wait through at least two 15-second refresh cycles.
- Confirm expansion and keyboard focus remain stable.
- Confirm unchanged silent refreshes do not visibly rebuild the queue.
- Exercise valid status updates and confirm the live status announcement.
- Cancel confirmation dialogs and verify that no mutation occurs.
- Double-click an action and verify that the busy-state guard prevents duplicate submission.
- Test View Bill and print only as an authorized owner/manager.

## 6. Take Order workflow and concurrency checks

Use two authenticated Hotel A staff sessions and, where supported, one Hotel A QR session. Use disposable table numbers only.

Verify:

- Opening Take Order shows only the two entry choices before the menu or order form is opened.
- View Tables shows one card per normalized active table and only `new`, `confirmed`, or `preparing` root dine-in orders.
- Search and status filters preserve the active-table result set, and Open Order selects the intended existing record.
- Create New Order preserves the existing table, guest, phone, notes, item quantity, totals, Clear, and Place Order behavior.
- Menu search and category navigation remain responsive with 100-150 items and do not attach duplicate actions after refreshes.
- Unavailable items and combos outside their active window cannot be submitted; the live menu refresh message remains actionable.
- The desktop cart remains visible while browsing; the mobile summary opens a labelled, scrollable dialog and returns focus when closed with its button or Escape.
- Place Order creates exactly one order when double-clicked or repeatedly tapped.
- Submit the same unused table from two staff sessions at nearly the same time: exactly one request succeeds and the other receives the active-order conflict with an Open Existing Order action.
- Repeat the conflict check between staff-assisted and QR root ordering. Add-on orders linked by `parent_order_id` must remain allowed.
- Completing or cancelling the active root order releases the table; billing and payment exceptions do not create a second active root order.
- A normal status update does not receive a public-global-limiter `429`. If the dedicated staff mutation limit is intentionally exceeded, the retry message and `Retry-After` guidance are shown.

## 7. KDS and billing regression checks

Verify:

- New orders appear in KDS without manual page reload.
- Kitchen stages remain separate from customer order statuses.
- Accepted, preparing, ready, served, delayed, and cancelled KDS actions still use existing values.
- Updating KDS does not change billing, payment, or customer order status unexpectedly.
- Mark billed generates or preserves the existing bill number.
- Mark paid updates only the intended order or explicitly selected order family.
- Add-on family actions update the correct linked records.
- Room-service charge-to-room behavior remains unchanged.
- Invoice and print output use backend-provided totals.

## 8. Responsive matrix

Test at browser zoom 100% unless a zoom test is explicitly being performed.

| Width | Required checks |
|---|---|
| 320px | One-column quick facts, no page overflow, usable drawer, full-width state actions |
| 360px | Readable cards, filter disclosure, touch targets, long text wrapping |
| 375px | Status-pill scrolling, expanded details, keyboard focus visibility |
| 390px | Two-column quick facts where space allows, no clipped amounts or labels |
| 414px | Mobile drawer backdrop, Escape dismissal, background scroll lock |
| 768px | Tablet navigation collapse, filter grid, summary wrapping |
| 1024px | Compact dashboard navigation and efficient order workspace width |
| 1440px | Sticky desktop sidebar, balanced summaries, readable queue density |

At every width verify:

- `document.documentElement.scrollWidth` does not exceed `document.documentElement.clientWidth`.
- No fixed element covers the active control.
- Date and select controls remain usable.
- Status pills can be reached by keyboard.
- Focus is visible and returns after closing the mobile drawer.
- Long IDs, names, notes, and monetary values wrap without breaking layout.
- Take Order home cards, active-table cards, menu search, category navigation, quantity controls, cart summary, and Place Order remain reachable.
- Mobile cart content scrolls without covering the active control; tablet and desktop carts do not obscure menu results.

## 9. Loading and failure checks

Using approved browser/network throttling:

- Confirm skeleton cards display during a slow manual load.
- Confirm filters and range remain selected.
- Confirm zero-order and no-filter-match states show the correct copy.
- Confirm Clear filters restores the loaded queue.
- Force an Orders API failure and confirm Try again appears.
- Confirm a silent polling failure leaves the existing queue visible.
- Expire the staff session and confirm no technical stack trace is shown.

## 10. Tenant-isolation checks

Perform these checks with disposable data only:

- Hotel A cannot list Hotel B orders.
- Hotel A cannot update a Hotel B order ID.
- Hotel A cannot open a Hotel B bill through a modified ID.
- Hotel A KDS cannot list or mutate Hotel B orders.
- Hotel A room-service records cannot reference Hotel B bookings or rooms.
- Basic staff cannot obtain manager financial fields by changing frontend controls.
- A hidden or removed button does not bypass backend authorization.
- Hotel A cannot query or open Hotel B active-table orders by changing the table number, order ID, or frontend state.

Expected cross-tenant result: an empty scoped result, `403`, or `404` according to the existing route contract—never Hotel B data.

## 11. Sign-off record

Record:

- Test environment and build identifier.
- Browser names and versions.
- Tested widths.
- Test hotel slugs without credentials.
- Owner and basic-staff results.
- Passed verifier output.
- Failed checks with screenshots or console/network evidence.
- Final approver and date.

Do not mark production QA complete while any tenant-isolation, permission, payment, billing, or KDS regression remains unresolved.
