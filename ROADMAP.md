# Roadmap

## Phase 0 — Foundation (this repository, current state)

Implemented:

- Project scaffold: Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind v4 +
  shadcn/ui, ESLint, Prettier.
- Design tokens: CHAIOBOUTIQUE palette (dusty rose/blush, warm ivory) as CSS variables, Geist
  (UI) + Playfair Display (headings) fonts, temporary typographic wordmark.
- Database: Prisma 7 (driver adapter) against PostgreSQL/Supabase, `DATABASE_URL` (pooled) /
  `DIRECT_URL` (migrations) / `TEST_DATABASE_URL` (integration tests) separation.
- Auth: Better Auth, email/password, database sessions, password reset (Mailpit in dev),
  disabled/soft-deleted user enforcement, session revocation on disable/delete/password change.
- RBAC: data-driven `Role`/`Permission`/`UserRole`/`RolePermission` tables, a typed permission
  catalog in code, `requirePermission()`/`requireUser()` using `next/navigation`'s
  `forbidden()`/`unauthorized()` for real 403/401 responses.
- Store configuration: single-row table, admin-editable (name/currency/locale/timezone).
- Audit log: append-only (by convention), wired into user/role/settings mutations.
- Storage: `StorageProvider` interface + Supabase implementation + validation utilities (no
  upload UI yet — nothing to attach files to).
- Email: `EmailProvider` interface + Mailpit/SMTP implementation (Resend deferred).
- Layouts: public site, auth, admin (responsive sidebar), POS placeholder; `forbidden.tsx`,
  `unauthorized.tsx`, `not-found.tsx`, `error.tsx`, `loading.tsx`.
- Admin pages: dashboard (placeholder metrics, profit-gated), profile (+ change password),
  users (create/disable/enable/revoke sessions/assign roles), roles (permission editor),
  permissions (read-only catalog), store settings.
- Tests: unit (permission/role catalog integrity, storage validation, auth schemas, one
  component render test) + integration (seed correctness, RBAC evaluation, audited role
  mutations, against `TEST_DATABASE_URL`) + Playwright smoke test and fixtures.

Explicitly **not** built this phase (see each module's own future phase below): catalog,
inventory, purchasing, customers (commercial CRM fields), sales, POS transactions, payments,
shipping, invoicing, cash register, reports.

## Phase 1 — Catalog & Inventory (proposed, not started)

Requires its own data-model review before implementation, per the standing rule that catalog
work only begins after that review is presented and approved:

- Products, variants (size/color), brands, categories/subcategories, tags, images.
- Warehouses, variant-level stock (available/reserved/physical/incoming).
- Inventory movements (all types from the original spec: purchase, sale, return, adjustment,
  damaged, lost, reservation, transfer, initial import) — every stock change goes through a
  movement record inside a transaction, never a silent overwrite.
- Price/cost history.

## Phase 2 — Suppliers & Purchasing (proposed)

- Suppliers, purchase orders, partial/complete reception, accounts payable.
- Receiving a purchase creates inventory movements and updates product cost — never increases
  stock before physical reception (unless the business explicitly configures otherwise).

## Phase 3 — Customers & Sales (proposed)

- Customer CRM fields (addresses, purchase history, segments, balance, coupons).
- Cart → Order → Sale → Payment → Invoice → Shipment kept as separate concepts (not one giant
  order table), with explicit, validated status transitions.
- Historical cost preserved per sale line item (never recomputed from current cost).

## Phase 4 — Point of Sale (proposed)

- Product/SKU/barcode search, cart, customer selection, split payments, exchanges/returns,
  cash register integration, receipt/invoice generation.

## Phase 5 — Cash Register & Expenses (proposed)

- Opening/closing, cash counts, expected vs. actual balance, payment-method breakdown, expenses.

## Phase 6 — Payments: Mercado Pago (proposed)

- Implements the `PaymentProvider` interface documented in [INTEGRATIONS.md](./INTEGRATIONS.md).
- Server-verified payment status only; idempotent webhooks; no stored card data.

## Phase 7 — Shipping: Andreani (proposed)

- Implements the `ShippingProvider` interface documented in
  [INTEGRATIONS.md](./INTEGRATIONS.md); mock provider until real credentials/docs exist.

## Phase 8 — Electronic Invoicing: ARCA (proposed)

- Requires its own reviewed fiscal data model (CAE, points of sale, invoice types, homologation
  vs. production) before any code — no fiscal fields exist on `StoreConfiguration` today by
  design.

## Phase 9 — Reporting & Profitability (proposed)

- Gross/net revenue, COGS, gross/contribution profit, by product/category/rep/channel/period —
  built on the historical cost data preserved from Phase 3 onward, respecting `reports.view` /
  `reports.view_profit` permission gating already in place.

## Ongoing / cross-cutting

- Real rate limiting (currently in-memory only — see [SECURITY.md](./SECURITY.md)).
- Google OAuth / passkeys (Better Auth is architecturally ready; not enabled).
- Email verification enforcement (config flag exists, off until a production provider is wired).
- Production hosting configuration (Vercel + Supabase) — deferred until explicitly requested.
