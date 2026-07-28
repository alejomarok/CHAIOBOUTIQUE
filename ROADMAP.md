# Roadmap

## Phase 0 — Foundation (implemented)

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

## Phase 1 — Catalog & Inventory (implemented)

Its data-model review happened before implementation, per the standing rule — see
[docs/adr/0001-monetary-strategy.md](./docs/adr/0001-monetary-strategy.md) and
[docs/adr/0002-inventory-balance-projection.md](./docs/adr/0002-inventory-balance-projection.md)
for the two decisions that shaped it most.

Implemented:

- Catalog: `Category` (self-referencing, cycle-checked), `Brand`, `Size`/`Color`, `Product`
  (draft/active/inactive/archived, category/brand-optional-until-published), `ProductVariant`
  (size/color axes, SKU/barcode unique, per-variant price/cost override), `ProductImage`
  (Supabase Storage, magic-byte validated, exactly one primary per product).
- Pricing: `BigInt` minor-unit money throughout (never `Int`/float — see ADR-1), effective-price
  fallback (variant → product default), compare-at validation.
- Inventory: `Warehouse` (single default), `InventoryBalance` (derived projection),
  `InventoryOperation`/`InventoryMovement` (append-only ledger, DB-trigger-enforced, atomic
  guarded updates, real idempotency keys — see ADR-2). Manual adjustments and warehouse-to-
  warehouse transfers, both audited in the same transaction as the state change.
- Public storefront: `/catalog` (filterable, paginated) and `/product/[slug]`, backed by a single
  DTO boundary (`modules/products/public-queries.ts`) that structurally excludes cost, legacy
  ids, and exact stock counts — public "in stock" is a derived status, not a number.
- Admin UI: full CRUD for categories/brands/sizes/colors/warehouses, product create/edit with
  variant matrix generation, inventory adjustment/transfer forms, movement history.
- Migration-import foundation: a generic CSV pipeline (`/admin/imports/products`) for
  categories/brands/products/variants/initial stock — per-row transactions, partial-failure
  tolerant, idempotent on re-upload. Not mapped to any specific legacy system yet; that mapping
  is added once a real sample export exists.
- 12 new permission keys (`categories.*`, `brands.*`, `attributes.*`, `warehouses.*`,
  `products.archive`, `product_images.manage`, `product_imports.*`), wired into the MANAGER/
  WAREHOUSE role definitions — see [PERMISSIONS.md](./PERMISSIONS.md).

Explicitly **not** built this phase (see later phases below): suppliers, purchase orders,
supplier invoices, customer management, in-store sales/POS transactions, ecommerce checkout/cart/
orders, payments, cash register, shipping, electronic invoicing, sales-related returns, profit
reports.

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
