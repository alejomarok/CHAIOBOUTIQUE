# Roles and Permissions

## How this works

- **Roles are data**, not a Prisma enum (`Role` table, `src/modules/roles/catalog.ts` seeds the
  6 system roles). New roles can be created from the admin UI without a migration.
- **Permission keys are code**, defined once in `src/modules/permissions/catalog.ts` as a typed
  union (`Permission`). The seed upserts the `Permission` table from that same list, so the
  database can never drift from what the application understands a key to mean, and
  `requirePermission("sales.cancel")` is a compile-time error if the key doesn't exist.
- A user's effective permissions are the **union** of every role assigned to them
  (`UserRole` supports multiple roles per user natively).
- **Hiding a button is never authorization.** Every protected page/action calls
  `requirePermission()` server-side (`src/modules/auth/require-permission.ts`), which returns a
  real HTTP 403 via `next/navigation`'s `forbidden()` if the check fails — see
  [ARCHITECTURE.md](./ARCHITECTURE.md#authorization).
- `CUSTOMER` intentionally has **zero** entries in `RolePermission`. Customer-facing access (own
  profile/orders/invoices/shipments/favorites) is authorized by entity ownership
  (`userId === self`), not by this admin/POS permission catalog — that logic belongs to the
  customer-account module, not built this phase.

## Permission catalog

| Key                    | Meaning                                    |
| ---------------------- | ------------------------------------------ |
| `products.view`        | View products                              |
| `products.create`      | Create products                            |
| `products.edit`        | Edit products                              |
| `products.delete`      | Delete products                            |
| `products.publish`     | Publish/unpublish products                 |
| `products.view_cost`   | View product purchasing cost               |
| `prices.view`          | View selling prices                        |
| `prices.manage`        | Change selling/promotional prices          |
| `stock.view`           | View stock levels                          |
| `stock.adjust`         | Create inventory adjustments               |
| `stock.transfer`       | Transfer stock between warehouses          |
| `stock.view_movements` | View the inventory movement ledger         |
| `suppliers.view`       | View suppliers                             |
| `suppliers.manage`     | Create/edit suppliers                      |
| `purchases.view`       | View purchase orders                       |
| `purchases.create`     | Create purchase orders                     |
| `purchases.receive`    | Receive purchase orders (partial/complete) |
| `purchases.cancel`     | Cancel purchase orders                     |
| `customers.view`       | View customers                             |
| `customers.manage`     | Create/edit customers                      |
| `sales.create`         | Create a sale (POS/online)                 |
| `sales.view`           | View sales                                 |
| `sales.cancel`         | Cancel a completed sale                    |
| `sales.refund`         | Refund/exchange a sale                     |
| `sales.apply_discount` | Apply a discount at time of sale           |
| `cash_register.open`   | Open a cash register session               |
| `cash_register.close`  | Close a cash register session              |
| `cash_register.view`   | View cash register history                 |
| `expenses.view`        | View expenses                              |
| `expenses.manage`      | Record/edit expenses                       |
| `orders.view`          | View online orders                         |
| `orders.manage`        | Prepare/update online orders               |
| `shipments.view`       | View shipments                             |
| `shipments.manage`     | Create/update shipments                    |
| `invoices.view`        | View invoices                              |
| `invoices.issue`       | Issue an invoice/receipt                   |
| `invoices.cancel`      | Cancel/credit-note an invoice              |
| `reports.view`         | View non-financial reports                 |
| `reports.view_profit`  | View profitability figures                 |
| `users.view`           | View staff users                           |
| `users.manage`         | Create/disable/assign roles to staff users |
| `roles.manage`         | Create roles, edit role permissions        |
| `settings.view`        | View store settings                        |
| `settings.manage`      | Edit store settings                        |
| `audit.view`           | View the audit log                         |
| `products.archive`     | Archive products                           |
| `categories.view`      | View categories                            |
| `categories.manage`    | Create/edit/archive categories             |
| `brands.view`          | View brands                                |
| `brands.manage`        | Create/edit brands                         |
| `attributes.view`      | View sizes and colors                      |
| `attributes.manage`    | Create/edit sizes and colors               |
| `warehouses.view`      | View warehouses                            |
| `warehouses.manage`    | Create/edit warehouses, set the default    |
| `product_images.manage`| Upload/delete/reorder product images       |
| `product_imports.view` | View migration import batches and history  |
| `product_imports.execute` | Run a migration import (dry-run or real) |

## Role → permission matrix

✓ = granted. ADMIN has every permission and is omitted from the "excluded" reasoning below since
it is the only role with unrestricted access by design.

| Permission           | MANAGER | SALES_REP | WAREHOUSE | ACCOUNTANT |
| -------------------- | :-----: | :-------: | :-------: | :--------: |
| products.view        |    ✓    |     ✓     |     ✓     |     ✓      |
| products.create      |    ✓    |           |           |            |
| products.edit        |    ✓    |           |           |            |
| products.delete      |    ✓    |           |           |            |
| products.publish     |    ✓    |           |           |            |
| products.view_cost   |    ✓    |           |           |     ✓      |
| prices.view          |    ✓    |     ✓     |           |     ✓      |
| prices.manage        |    ✓    |           |           |            |
| stock.view           |    ✓    |     ✓     |     ✓     |            |
| stock.adjust         |    ✓    |           |     ✓     |            |
| stock.transfer       |    ✓    |           |     ✓     |            |
| stock.view_movements |    ✓    |           |     ✓     |            |
| suppliers.view       |    ✓    |           |     ✓     |     ✓      |
| suppliers.manage     |    ✓    |           |           |            |
| purchases.view       |    ✓    |           |     ✓     |     ✓      |
| purchases.create     |    ✓    |           |           |            |
| purchases.receive    |    ✓    |           |     ✓     |            |
| purchases.cancel     |    ✓    |           |           |            |
| customers.view       |    ✓    |     ✓     |           |     ✓      |
| customers.manage     |    ✓    |     ✓     |           |            |
| sales.create         |    ✓    |     ✓     |           |            |
| sales.view           |    ✓    |     ✓     |           |     ✓      |
| sales.cancel         |    ✓    |           |           |            |
| sales.refund         |    ✓    |     ✓     |           |            |
| sales.apply_discount |    ✓    |     ✓     |           |            |
| cash_register.open   |    ✓    |     ✓     |           |            |
| cash_register.close  |    ✓    |     ✓     |           |            |
| cash_register.view   |    ✓    |     ✓     |           |     ✓      |
| expenses.view        |    ✓    |           |           |     ✓      |
| expenses.manage      |    ✓    |           |           |     ✓      |
| orders.view          |    ✓    |     ✓     |     ✓     |            |
| orders.manage        |    ✓    |     ✓     |     ✓     |            |
| shipments.view       |    ✓    |     ✓     |     ✓     |            |
| shipments.manage     |    ✓    |           |     ✓     |            |
| invoices.view        |    ✓    |     ✓     |           |     ✓      |
| invoices.issue       |    ✓    |     ✓     |           |     ✓      |
| invoices.cancel      |    ✓    |           |           |     ✓      |
| reports.view         |    ✓    |           |           |     ✓      |
| reports.view_profit  |    ✓    |           |           |     ✓      |
| users.view           |    ✓    |           |           |            |
| users.manage         |         |           |           |            |
| roles.manage         |         |           |           |            |
| settings.view        |    ✓    |           |           |     ✓      |
| settings.manage      |         |           |           |            |
| audit.view           |         |           |           |            |
| products.archive     |    ✓    |           |           |            |
| categories.view      |    ✓    |           |           |            |
| categories.manage    |    ✓    |           |           |            |
| brands.view          |    ✓    |           |           |            |
| brands.manage        |    ✓    |           |           |            |
| attributes.view      |    ✓    |           |           |            |
| attributes.manage    |    ✓    |           |           |            |
| warehouses.view      |    ✓    |           |     ✓     |            |
| warehouses.manage    |    ✓    |           |           |            |
| product_images.manage|    ✓    |           |           |            |
| product_imports.view |    ✓    |           |           |            |
| product_imports.execute |      |           |           |            |

`users.manage`, `roles.manage`, `settings.manage`, `audit.view`, and `product_imports.execute`
are **ADMIN-only** by design — see the exclusions below.

## Rationale per role

### MANAGER (Encargada)

Runs daily operations: catalog, pricing, inventory, suppliers, purchasing, customers, sales,
cash register, expenses, orders, shipments, invoices, and both report types. Also owns
day-to-day catalog curation (`categories.*`, `brands.*`, `attributes.*`, `warehouses.*`,
`product_images.manage`, `products.archive`) and can view import history
(`product_imports.view`). **Excluded**: `users.manage`, `roles.manage`, `settings.manage`,
`audit.view` — the spec's "should not automatically have access to highly sensitive system
settings or credentials" — and `product_imports.execute`: a bulk import can rewrite pricing and
stock across many rows in one action, a different risk class than the rest of MANAGER's
day-to-day operations, so it stays ADMIN-only as a reversible least-privilege default.

### SALES_REPRESENTATIVE (Vendedora)

Can sell, search products/stock, manage customers, apply discounts, process refunds/exchanges,
prepare online orders, issue receipts/invoices, and run their own cash register session.
**Excluded** (explicit spec requirements): `products.view_cost`, `reports.view_profit`,
`users.manage`, `roles.manage`, `prices.manage`, `sales.cancel` (a full sale cancellation is more
destructive than an authorized refund/exchange, which they can do via `sales.refund`),
`suppliers.*`, `purchases.*`.

### WAREHOUSE (Depósito)

Reception, stock adjustments/transfers, movement history, order and shipment preparation. Has
`warehouses.view` (needs to pick a warehouse when adjusting/transferring stock) but not
`warehouses.manage` (creating/editing warehouse entities) or `categories.*`/`attributes.*`
(catalog curation, not operational stock data). **Excluded**: anything financial
(`reports.view_profit`, `products.view_cost`, `cash_register.*`, `expenses.*`, `sales.*`,
`customers.*`, `invoices.*`).

### ACCOUNTANT (Contadora)

Invoicing (issue/cancel), expenses, both report types, cash register visibility (for
reconciliation), and enough view access (`products.view_cost`, `prices.view`, `suppliers.view`,
`purchases.view`, `customers.view`, `sales.view`) to do that job. **`settings.manage` is
deliberately not granted by default** — the spec says fiscal configuration access is "when
authorized," which this phase treats as an explicit future per-user override, not a default
grant.

### CUSTOMER (Cliente)

No entries — see "How this works" above.

## Future: per-user permission overrides

The schema (`UserRole`/`RolePermission` as separate join tables, `Permission` as its own table)
is structured so an individual-user override table could be added later without restructuring
existing data — not built this phase, per the original scope decision.
