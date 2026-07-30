# Hotel PMS + Restaurant POS SaaS: First-Client Readiness Audit

Audit date: 2026-07-29
Scope: repository and configured local environment at C:\Users\admin\Desktop\project2
Decision: **NO-GO for unrestricted production; eligible for a controlled pilot only after every P0 gate below is evidenced**

## 1. Executive decision

The product has broad functional coverage and strong automated source-level verification for its current stage. Core hotel, restaurant, billing, tax, payment-state, KDS, QR, tenant-scoping, and public-booking logic are present.

It is not production-ready today because the inspected runtime is still a development configuration, live release flags and URLs are not configured, the payment key is a test key, and there is no verified deployment, backup/restore drill, monitoring/on-call evidence, authenticated end-to-end release run, or successful representative load run. These are operational P0 gates, not cosmetic findings.

No permanent freeze is approved by this audit.

## 2. Architecture and surface inventory

- Static multipage frontend: index, admin, staff orders, kitchen display, menu, order tracking, and QR order status.
- Node.js/Express API with route, middleware, validator, utility, and configuration modules.
- Supabase/PostgreSQL persistence with SQL migrations, verification scripts, and feature-specific rollback/runbook files.
- JWT bearer authentication for staff/admin paths.
- Razorpay integration for online payments and webhooks.
- Polling-based KDS/status refresh with cancellation and page-visibility handling.
- Durable QR order outbox worker.
- No WebSocket or SSE layer was found.
- No Docker, Compose, Render, Railway, Vercel, Netlify, Wrangler, or GitHub Actions deployment definition was found.

## 3. Hotel PMS capability inventory

- Floors, room types, rooms, occupancy/capacity, amenities, and managed room images.
- Base/effective rates, date-bounded rate plans, negotiated rates, and GST rules.
- Public availability and booking, plus manual staff bookings.
- Advance-payment policies, payment capture state, and refunds.
- Check-in, stays, shifts/extensions, housekeeping, maintenance, and room-service linkage.
- Folio/checkout summaries, combined checkout feature work, immutable bill generation, thermal bills, and reports.
- Double-booking protection and hotel-scoped operational records.

## 4. Restaurant POS capability inventory

- Restaurant table master and secure table QR sessions.
- Staff, public QR/web, and room-service order entry.
- Active-table order locking and Add More Items rounds.
- KOT/KDS kitchen and expo workflow.
- Billing, paid/unpaid state, bill numbers, payment records, and thermal bills.
- Operational and business reporting.

## 5. Shared SaaS and tenant model

- Authenticated tenant identity is derived from trusted staff claims, not a client-selected hotel.
- Public tenant resolution uses hotel slug/domain/token paths and validates active hotel access.
- Newer tables include RLS policies; the service-role API also applies explicit hotel_slug filters.
- Platform administration is separated from hotel staff access.
- Current staff role model is primarily owner/staff, while KDS adds general/kitchen/expo/manager claims.
- A broader permission matrix and independent tenant-isolation penetration test remain advisable before enterprise rollout.

## 6. Public room-gallery production hardening

The existing gallery was upgraded without changing the room-card click contract, public image payload, booking fields, availability state, or booking submission flow.

- One reusable native dialog with proper modal semantics.
- Viewport-safe desktop layout and full-screen mobile layout.
- Uncropped room photography using contain sizing.
- Loading and image-failure states.
- Counter, arrows, keyboard navigation, stage-scoped swipe navigation, thumbnails, and full-screen action.
- Focus trap and focus return.
- Exact background scroll capture and restoration.
- Active thumbnail visibility and adjacent-image preload, respecting Save-Data.
- Single-image mode hides redundant thumbnails and disables navigation.
- Thumbnails are shown only when optimized thumbnail URLs exist.
- Existing Book this room handoff is preserved without resetting booking data.
- Reduced-motion and safe-area support.

## 7. Financial correctness evidence

- Room pricing and GST are calculated and snapshotted server-side.
- Date-effective tax/rate validation rejects bookings when a matching verified rule is missing.
- Advance payments cannot exceed the current booking amount.
- Restaurant bill and payment states are separately represented and verified.
- Payment/refund idempotency and webhook flows are present.
- Generated bills are designed as immutable records.
- The dine-in billing dry run found 13 billed-and-paid records, 0 billed-unpaid records, 0 paid-not-billed records, and 0 billed records missing bill numbers.
- A zero-value, unbilled sample order exists; it did not violate the billed-payment reconciliation check.

Production finance sign-off still requires live-key validation, real settlement/reconciliation evidence, GST review by the client’s accountant, and an approved end-of-day cash process.

## 8. Security assessment

Implemented controls include Helmet, configured CORS allowlisting, request size limits, public/auth/staff rate limiting, Zod validation, scoped JWT middleware, hotel-scoped queries, QR token validation, storage-path checks, and request-context logging.

Remaining release evidence:

- Rotate and verify production secrets outside source control.
- Confirm strict production CORS hosts and runtime URLs.
- Run authenticated cross-tenant negative tests in staging.
- Run dependency/SCA and secret scanning in an approved CI environment.
- Perform an external penetration test before broad multi-hotel rollout.
- Verify log redaction and retention against real production traffic.

The package-registry vulnerability audit was not completed in this workspace because outbound dependency-metadata disclosure was not authorized.

## 9. Database and migration assessment

- Feature migrations and rollback SQL are stored in backend/scripts.
- Hotel scoping, unique constraints, active-state rules, and newer RLS policies are present in the inspected SQL.
- Several critical booking, billing, rate, GST, KDS, QR, image, and payment invariants are enforced in database logic or validated server-side.
- There is no centralized migration runner/version ledger demonstrated by this audit.
- Migration ordering, idempotency, production rehearsal, schema-cache refresh, and rollback timing must be proven on a staging clone.

No database schema was changed by the gallery/readiness work in this audit.

## 10. Backup, recovery, and continuity

Repository backups content is source snapshot material, not evidence of a managed database backup program.

P0 requirements:

- Enable provider-managed point-in-time recovery or scheduled encrypted backups.
- Define owners, retention, encryption, access, and off-site policy.
- Declare business-approved RPO and RTO.
- Restore a recent production-like backup into an isolated environment.
- Validate row counts, tenant scoping, images/storage references, bookings, orders, bills, payments, and audit records.
- Record restore duration and obtain owner sign-off.

Until the restore drill passes, recoverability is unverified.

## 11. Deployment and environment readiness

The production configuration verifier currently reports development mode, local HTTP frontend/admin URLs, missing public API base URL, missing launch flags, an unacceptable JWT configuration assessment, a Razorpay test key, and source/runtime metadata mismatch.

Required before pilot:

1. Create a staging environment matching production topology.
2. Configure production URLs, domains, TLS, CORS, secrets, launch flags, and live payment mode through managed environment variables.
3. Run migrations against staging and refresh the API schema cache.
4. Run the complete release suite and authenticated browser flows.
5. Deploy a versioned build with a documented rollback target.
6. Repeat the smoke suite in production with synthetic/non-customer records.

## 12. Monitoring and observability

The API exposes health/readiness endpoints and structured request logging with request/database timing. No deployed monitoring stack, alert routing, uptime check, log aggregation, dashboard, or on-call evidence was found.

Minimum pilot alerts:

- API availability/readiness and latency.
- HTTP 5xx/429 spikes.
- Database errors and saturation symptoms.
- QR outbox backlog/failure.
- Payment webhook failure and reconciliation mismatch.
- Booking price/tax configuration rejection rates.
- KDS stale-order age.
- Backup failure and restore-test expiry.
- Storage/image upload failure.

## 13. Performance and scale

The read-only harness was run for health/readiness at simulated concurrency 10, 25, 50, 100, and 200 with two seconds per stage. All requests failed because no API was listening on 127.0.0.1:5000. Therefore throughput and latency from that attempt are invalid and must not be used as capacity evidence.

| Stage | Required proof |
|---|---|
| 1 hotel | Complete booking, POS, KDS, billing, payment, refund, checkout, and reporting journey |
| 10 hotels | Cross-tenant negative tests plus normal peak workload |
| 25 hotels | Mixed read/write traffic, QR/KDS polling, webhook bursts |
| 50 hotels | Database index/slow-query review, queue backlog, rate-limit behavior |
| 100 hotels | Horizontal API scaling, connection management, cache/queue plan |
| 200 hotels | Soak test, failover exercise, recovery test, cost/capacity model |

Every stage must use distinct tenant credentials and representative data. Health-only concurrency is not a business-workload benchmark.

## 14. Browser, responsive, and accessibility QA

Automated source checks cover responsive gallery sizing, keyboard controls, focus behavior, mobile safe areas, reduced motion, image loading/failure handling, and preserved booking handoff.

Rendered browser QA and screenshots could not be completed because the available Windows browser sandbox failed while applying filesystem ACLs. This is an audit-environment limitation, not proof that the UI passes or fails visually.

Before pilot, test Chrome, Edge, Safari/iOS, and Android at 320, 360, 390, 768, 1024, 1440, and short landscape viewports. Include keyboard-only, screen-reader smoke, zoom at 200%, slow network, offline/error states, and real managed room images.

## 15. Test evidence

Passed source/schema/contract verifiers:

- Public frontend production baseline.
- Public room-gallery production hardening.
- Existing room-operations gallery contract (13/13).
- Secure QR ordering.
- Production KDS.
- Restaurant table master.
- Staff active-table ordering.
- Add More Items.
- Dine-in billing dry run.
- Food-order bill.
- Production room PMS/GST (15/15).
- Room double-booking safety.
- Professional room operations.
- Room checkout readiness against the configured schema.
- Room checkout thermal bill.
- Staff reports.
- Tenant-domain trust, with the expected warning that no non-local production host is configured.
- Admin platform access.
- Staff access schema.
- Staff Orders release, with authenticated responsive E2E still required.

Failed or unverified:

- Production configuration and first-client launch profile.
- Representative load/capacity test.
- Rendered browser/screenshots.
- Live payment settlement/refund/reconciliation.
- External dependency vulnerability scan.
- Backup restoration.
- Production deployment, monitoring, and on-call exercise.

## 16. Severity register

### P0 — release blockers

1. Production runtime/configuration is not ready.
2. Live payment and financial reconciliation evidence is absent.
3. Database backup/restore drill and RPO/RTO are absent.
4. No verified staging/production deployment and rollback rehearsal.
5. No authenticated end-to-end release run across the core journeys.
6. No successful representative multi-tenant load/soak run.
7. No deployed monitoring, alert routing, and on-call drill.

### P1 — required for a dependable pilot

1. End-of-day cash/payment reconciliation procedure and ownership.
2. Combined-checkout flag decision and staging proof.
3. Browser/device/accessibility matrix completion.
4. Client onboarding, staff training, support contacts, and escalation rehearsal.
5. Migration ledger/order and release checklist discipline.

### P2 — near-term hardening

1. CI/CD gates for lint/tests/SCA/secrets/migrations.
2. External cache/queue where measurement justifies it.
3. Finer role/permission matrix.
4. Centralized audit, metrics, and business-event dashboards.
5. Automated tenant provisioning and readiness scorecard.

### P3 — scale/enterprise enhancement

1. WebSocket/SSE for selected real-time surfaces if polling cost/latency warrants it.
2. Regional failover and disaster-recovery automation.
3. Advanced revenue management and channel integrations.
4. Enterprise SSO and policy controls.

### P4 — optional product expansion

Guest loyalty, CRM campaigns, native mobile apps, advanced BI, and marketplace integrations.

## 17. First-client onboarding workflow

Use FIRST-CLIENT-OPERATIONS-RUNBOOK.md. At minimum:

1. Contract, data-processing, tax, payment, support, and operating-owner sign-off.
2. Production domain and tenant record.
3. Floors, room types, rooms, tables, taxes, rates, menus, staff, permissions, and branding.
4. Verified sample booking/order/payment/refund/checkout.
5. Night audit/EOD rehearsal.
6. Backup restore evidence.
7. Staff training and acceptance.
8. Pilot opening with monitored hours and rollback authority.

## 18. Support readiness

- SEV-1: booking/payment/checkout unavailable, data isolation risk, or financial corruption.
- SEV-2: major workflow impaired with a workaround.
- SEV-3: limited defect or reporting mismatch.
- SEV-4: cosmetic or enhancement request.

The first client must receive a support channel, operating hours, escalation contacts, response targets, incident update cadence, and post-incident review process.

## 19. Known limitations

- Polling rather than push real-time transport.
- Predominantly owner/staff role model.
- No verified external cache/queue tier.
- No proven capacity at 10–200 distinct hotels.
- No documented provider-independent disaster recovery.
- Current local configuration is not production-like.
- Screenshot/visual browser validation remains outstanding.

## 20. Files changed by this audit

- frontend/index.html — accessible gallery structure and explicit state elements.
- frontend/css/style.css — scoped responsive gallery styling.
- frontend/js/main.js — gallery lifecycle, focus, scroll, loading/error, preload, and navigation behavior.
- backend/scripts/verify-public-room-gallery-production.js — gallery contract verifier.
- backend/package.json — verifier commands.
- backend/scripts/FULL-SAAS-CLIENT-READINESS-AUDIT.md — this audit.
- backend/scripts/FIRST-CLIENT-OPERATIONS-RUNBOOK.md — operational gate/runbook.
- backend/scripts/verify-client-readiness-documentation.js — documentation gate.

No API payload, status transition, booking calculation, payment logic, database migration, or tenant resolution behavior was intentionally changed.

## 21. Rollback plan

1. Stop new release traffic or return traffic to the last known-good version.
2. Restore only the three frontend gallery files and backend/package.json from the prior version.
3. Remove the new audit/verifier documents if release packaging requires it.
4. Re-run the previous public frontend and room-gallery contract verifiers.
5. Smoke-test room cards, gallery close, availability, booking submission, and mobile scroll restoration.

Database rollback: none is required for this audit because no schema/data migration was introduced.

Operational rollback must define who can disable public booking/payment, how pending payments/webhooks are reconciled, how guests are contacted, and how the last known-good build is restored.

## 22. Launch gate and freeze rule

The decision may move from **NO-GO** to **CONDITIONAL GO** only when every P0 item has dated evidence, an owner, a rollback target, and approval from product/operations/finance/security stakeholders.

It may move to unrestricted **GO** only after the monitored pilot completes without unresolved SEV-1/SEV-2 issues and financial, tenant-isolation, restore, and capacity evidence are signed off.

Do not freeze the product based on this audit. Freeze only after the user explicitly confirms the completed evidence pack and authorizes the freeze.
