# Database

PostgreSQL (hosted on Supabase) is the single source of truth for all commercial, inventory,
financial, and operational data. This document covers the schema through the catalog/inventory
phase, connection strategy, and the conventions future phases must follow.

## Connection strategy

Prisma 7 requires an explicit driver adapter and no longer reads a connection URL from
`schema.prisma`'s `datasource` block. Two different URLs are used for two different purposes:

- **`DATABASE_URL`** — Supabase's **Transaction pooler** (port 6543, `?pgbouncer=true`). Used by
  the running application (`src/lib/db.ts`, via `@prisma/adapter-pg`). Safe for many short-lived
  serverless connections.
- **`DIRECT_URL`** — Supabase's **direct connection or Session pooler** (port 5432). Used only by
  the Prisma CLI (`prisma migrate dev/deploy`, `prisma db seed`), configured in
  `prisma.config.ts`. PgBouncer's transaction mode cannot run schema migrations, so migrations
  need a non-pooled (or session-pooled) connection.
- **`TEST_DATABASE_URL`** — a **separate** Postgres instance (the provided `docker-compose.yml`
  runs one on `localhost:55432`), used only by integration tests and `npm run db:test:migrate`.
  Never the same value as `DATABASE_URL`. `scripts/with-test-db.mjs` enforces this: it refuses to
  run if `TEST_DATABASE_URL` is unset, and force-overrides `DATABASE_URL`/`DIRECT_URL` to it for
  the duration of the test command — this is deliberate so a test run can never silently fall
  back to the dev/prod database.

```ts
// src/lib/db.ts
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

```ts
// prisma.config.ts
export default defineConfig({
  datasource: { url: env("DIRECT_URL") },
  migrations: { seed: "tsx prisma/seed.ts" },
});
```

Rationale for splitting dev vs. test onto different hosts entirely (rather than a second schema
on the same Supabase project): faster (no network round-trip), free (doesn't consume Supabase
project quota on every test run), and structurally impossible to point at by accident. A second
Supabase project/branch is an equally valid alternative if that's ever preferred — this is a
reversible default.

## Schema overview (foundation phase)

### Authentication (Better Auth)

`User`, `Session`, `Account`, `Verification` — field shapes follow Better Auth's documented
Prisma adapter schema exactly (the adapter is sensitive to field names/casing). `User` has three
extra, application-owned fields Better Auth doesn't manage: `isActive`, `disabledAt`,
`deletedAt` — see [ARCHITECTURE.md](./ARCHITECTURE.md#authentication) for how these are enforced.

### RBAC (data-driven, not a Prisma enum)

- `Role` — `key` (machine id, e.g. `ADMIN`), `name`/`description` (Spanish, user-facing),
  `isSystem` (protects the 6 seeded roles from deletion — service-layer only, see
  [ARCHITECTURE.md](./ARCHITECTURE.md#known-limitations-tracked-not-hidden)), `isActive`,
  `deletedAt` (soft delete).
- `Permission` — `key` (e.g. `products.view_cost`), upserted from the typed catalog in
  `src/modules/permissions/catalog.ts`.
- `UserRole` — join table, `userId` + `roleId` unique, `assignedAt`/`assignedBy`.
- `RolePermission` — join table, `roleId` + `permissionId` unique.

### Store configuration

`StoreConfiguration` — single row, id fixed to the literal `"main"` (a second insert collides on
the primary key instead of silently creating a second "store"). Holds name/currency/locale/
timezone. No fiscal fields — those are explicitly deferred to their own reviewed data model (see
[INTEGRATIONS.md](./INTEGRATIONS.md#electronic-invoicing-arca)).

### Audit log

`AuditLog` — `userId` (nullable, for system actions), `action`, `entityType`/`entityId`,
`previousValue`/`newValue` (JSON), `ipAddress`, `userAgent`, `correlationId`, `metadata`,
`createdAt`. Insert-only by application convention (`src/modules/audit`), and — since the
catalog/inventory phase — by a database-level trigger too (see "Append-only enforcement" below).
See [SECURITY.md](./SECURITY.md#audit-logging) for what must never be written here.

### Catalog core (Category, Brand, Size, Color, Product, ProductVariant, ProductImage)

- `Category` — self-referencing `parentId` (cycle prevention is an app-level check in
  `modules/categories/service.ts`; Postgres has no declarative arbitrary-depth-cycle
  constraint), `slug` (unique), soft-archived via `archivedAt`/`isActive` rather than deleted
  (a category referenced by a product is also protected at the DB level:
  `Product.category` is `onDelete: Restrict`). `legacySource`/`legacyId` (compound unique,
  nullable) support the import pipeline below.
- `Brand`, `Size`, `Color` — straightforward lookup tables. `Size`/`Color` have a `key` (stable,
  human-chosen identifier used by variant imports — e.g. `"m"`, `"azul"`) separate from `id`.
- `Product` — `status` (`DRAFT`/`ACTIVE`/`INACTIVE`/`ARCHIVED`), `categoryId`/`brandId` nullable
  (a product can exist in `DRAFT` before categorization; `status` can never become `ACTIVE`
  without a `categoryId` — enforced in `modules/products/service.ts`'s `setProductStatus`, not
  just at read time). Monetary columns (`defaultPriceAmount`, `compareAtPriceAmount`,
  `referenceCostAmount`) are `BigInt` minor units — see
  [ADR-1](./docs/adr/0001-monetary-strategy.md). `legacySource`/`legacyId` compound-unique, same
  as `Category`/`Brand`.
- `ProductVariant` — `sku`/`barcode` unique, `priceAmount`/`compareAtPriceAmount`/`costAmount`
  nullable `BigInt` (null `priceAmount` falls back to `Product.defaultPriceAmount` — see
  `modules/products/pricing.ts`'s `getEffectivePrice`). Uniqueness on `(productId, sizeId,
  colorId)` only covers the fully-specified case; see "Partial indexes" below for the null-axis
  cases (a product's single default variant, or one variant per size with no color, etc.).
- `ProductImage` — `bucket`/`path`/`contentType`/`fileSize`/`width`/`height` (metadata only, the
  binary lives in Supabase Storage — see [INTEGRATIONS.md](./INTEGRATIONS.md)), `isPrimary`
  (exactly one per product — see "Partial indexes" below).

### Inventory core (Warehouse, InventoryBalance, InventoryOperation, InventoryMovement)

Full design rationale in [ADR-2](./docs/adr/0002-inventory-balance-projection.md). Summary:

- `Warehouse` — `isDefault` (exactly one; see "Partial indexes"), also, for this phase only, the
  single warehouse public "in stock" status is read from (see ADR-2).
- `InventoryBalance` — a **derived projection**, not an independent source of truth. Written only
  through one guarded atomic `UPDATE` in `modules/inventory/service.ts`'s
  `applyInventoryOperation` — never `SELECT`-then-`UPDATE`, never optimistic locking.
  `(variantId, warehouseId)` unique.
- `InventoryOperation` — the aggregate root: one row per business event (adjustment, transfer,
  imported stock row), however many `InventoryMovement` rows it produces.
  `idempotencyKey` (nullable, unique) is the real duplicate-prevention mechanism;
  `correlationId` is grouping-for-observability only. See
  `modules/inventory/idempotency.ts` for the generation strategy per source.
- `InventoryMovement` — immutable ledger rows: `quantityDelta`/`previousQuantity`/`newQuantity`,
  `movementType` (`INITIAL_STOCK`, `ADJUSTMENT_IN`/`OUT`, `DAMAGE`, `LOSS`,
  `INTERNAL_CORRECTION`, `TRANSFER_OUT`/`IN`). No update/delete function is exposed, and the
  database itself refuses `UPDATE`/`DELETE` — see "Append-only enforcement" below.

### Migration-import foundation (ImportBatch, ImportIssue)

`src/modules/imports/` — a generic, documented CSV pipeline for loading catalog/inventory data
from a legacy system, not a mapping for any specific one (that waits for a real sample export).

- `ImportBatch` — one row per parse attempt (dry-run preview or real execution; each is a
  self-contained call, see below), `importType` (`CATEGORIES`/`BRANDS`/`PRODUCTS`/`VARIANTS`/
  `INITIAL_STOCK`), `sourceSystem` (a free-text label identifying the legacy system — also the
  scope for `legacySource`/`legacyId` uniqueness and for import idempotency keys),
  `fileChecksum` (SHA-256 of the uploaded bytes, recorded for traceability, not itself used for
  dedup — row-level idempotency keys are), `status`
  (`UPLOADED`/`VALIDATING`/`READY`/`IMPORTING`/`COMPLETED`/`COMPLETED_WITH_ERRORS`/`FAILED`/
  `CANCELLED`), row counters.
- `ImportIssue` — one row per rejected/problem row (`rowNumber`, `errorCode`, `message`,
  `rawRowSnapshot` for troubleshooting). Cascade-deleted with its `ImportBatch`.

**No file is persisted server-side between steps.** The admin UI (`/admin/imports/products`)
reads the uploaded CSV into memory in the same request for both the dry-run preview and the real
execution — there's no intermediate storage bucket or job queue this phase. A "preview" and its
subsequent "execute" are two independent calls against the same in-browser file selection, each
producing its own `ImportBatch` row; `cancelImportBatch` is offered only as an explicit
after-the-fact annotation on a `READY` (previewed-but-not-executed) batch, not a live abort of an
in-progress job, since there is no async job to interrupt in this synchronous, single-request
design.

**Execution model**: one `$transaction` per row (`modules/imports/row-processors.ts`), never one
transaction for the whole file. A bad row is recorded as an `ImportIssue` and processing
continues — rows already committed before it are never rolled back. Row-level idempotency
(`(sourceSystem, legacyId)` for catalog rows via each model's compound unique index; a
deterministic key derived the same way for `INITIAL_STOCK` rows — see
[ADR-2](./docs/adr/0002-inventory-balance-projection.md)) means re-uploading the same file, or a
corrected re-export containing rows already imported, safely skips what's already applied instead
of double-applying it.

**Known limitation, documented rather than solved this phase**: catalog rows are processed
single-pass, in file order — a `CATEGORIES` row whose `parentLegacyId` refers to a row appearing
*later* in the same file fails with `PARENT_NOT_FOUND`. Source files must list parents before
children (categories before their children, products before their variants, and so on).

## Table and field naming convention

Every table uses a singular, `snake_case` name via `@@map` (`@@map("product_variant")`,
`@@map("inventory_operation")`, `@@map("import_batch")`, etc.); every field keeps its exact
Prisma camelCase name with no field-level `@map` (e.g. `InventoryMovement.quantityDelta` is
literally the quoted Postgres column `"quantityDelta"`). Raw SQL in application code (the guarded
`InventoryBalance` update, the append-only triggers below) uses these exact, verified names —
never assumed.

## Partial indexes — hand-written migration SQL, not Prisma's preview feature

Prisma 7.4+ has a `partialIndexes` preview feature that can express a partial unique index
directly in `schema.prisma`. It is **deliberately not used** here: `prisma/prisma#29263` (open
against 7.4.1) reports that it causes Prisma to spuriously drop and recreate the same partial
index on every `prisma migrate dev` run, even when nothing about that index changed — a real
problem across a schema that gets many incremental migrations. Revisit once that issue is closed
and the feature leaves preview; this is a reversible, documented simplification, not a permanent
stance.

Every partial index in this schema is instead added by hand-editing the generated migration SQL
(`prisma migrate dev --create-only`, then edit the `.sql` file, then `prisma migrate dev` to
apply — see "Migrations" below):

```sql
-- ProductVariant: at most one "default" (no size, no color), one per size
-- with no color, and one per color with no size. The fully-specified case
-- (both set) is covered by the normal @@unique([productId, sizeId, colorId])
-- declared directly in schema.prisma.
CREATE UNIQUE INDEX product_variant_no_axis_unique
  ON product_variant("productId") WHERE "sizeId" IS NULL AND "colorId" IS NULL;
CREATE UNIQUE INDEX product_variant_size_only_unique
  ON product_variant("productId", "sizeId") WHERE "sizeId" IS NOT NULL AND "colorId" IS NULL;
CREATE UNIQUE INDEX product_variant_color_only_unique
  ON product_variant("productId", "colorId") WHERE "colorId" IS NOT NULL AND "sizeId" IS NULL;

-- Warehouse: exactly one default.
CREATE UNIQUE INDEX warehouse_default_unique
  ON warehouse("isDefault") WHERE "isDefault" = true;

-- ProductImage: exactly one primary image per product.
CREATE UNIQUE INDEX product_image_primary_unique
  ON product_image("productId") WHERE "isPrimary" = true;
```

Because these live inside a checked-in migration file, later `prisma migrate dev` runs diff
against Prisma's replayed migration history, not just `schema.prisma` — they don't drift or get
silently dropped. Each affected model has a comment in `schema.prisma` pointing back here. Every
one of these invariants also has a service-layer check (`createVariants`'s duplicate-combination
check, `setDefaultWarehouse`'s unset-then-set transaction, `setPrimaryImage`'s equivalent) — the
index is the actual guarantee under concurrency; the service-layer check is a fast, friendly
error before hitting it.

## Append-only enforcement (inventory_movement, audit_log)

Beyond "no update/delete function is exposed" (true for both tables, by application convention),
a Postgres trigger blocks `UPDATE`/`DELETE` at the database level — applied to **every** database
role, including the application's own connection, so this is real defense in depth, not just a
convention the application layer happens to follow:

```sql
CREATE OR REPLACE FUNCTION prevent_update_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movement_append_only
  BEFORE UPDATE OR DELETE ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
```

Added by the same hand-edited migration as the partial indexes above. See
[ADR-2](./docs/adr/0002-inventory-balance-projection.md) for the full rationale, and
`tests/integration/inventory.test.ts` for a test that directly attempts a raw `UPDATE`/`DELETE`
and asserts the trigger rejects it.

**Break-glass procedure** (manual, out-of-band, never automated): if an exceptional correction to
history is ever genuinely required, a human with a direct superuser/service Postgres connection
runs `ALTER TABLE inventory_movement DISABLE TRIGGER inventory_movement_append_only;` (or the
`audit_log` equivalent), performs the correction under manual review, then **immediately**
re-enables the trigger. There is no application code path for this — it's deliberately outside
what the running application can ever do to itself.

## Monetary values

**Decided: `BigInt` (Postgres `BIGINT`) minor units** (e.g. ARS centavos) for every monetary
column — never `Int`, never a JavaScript float. Full rationale, the Argentina-specific reasoning
for `BigInt` over `Int`, the string-based (float-free) parsing algorithm, and the
Server-Action/Client-Component serialization boundary rule: see
[ADR-1](./docs/adr/0001-monetary-strategy.md). This applies to every future
price/cost/cash-register/expense column, not just the catalog columns that introduced it.

## Timestamps and timezone

All `DateTime` columns are stored in UTC (Prisma's default mapping to Postgres `timestamptz`, no
manual timezone handling at the storage layer). Display formatting converts to the store's
configured timezone (`StoreConfiguration.timezone`, initially `America/Argentina/Cordoba`) at the
UI layer using `date-fns-tz` — never stored pre-converted.

## Migrations

For a schema change with **no** partial index or append-only trigger involved, the normal flow
applies:

```bash
npx prisma migrate dev           # dev, against DATABASE_URL/DIRECT_URL
npx prisma migrate deploy        # CI/production
npm run db:test:migrate          # against TEST_DATABASE_URL only
```

For the catalog/inventory migration specifically (or any future migration touching a partial
index or an append-only table), use `--create-only` and hand-edit the generated SQL **before**
applying it:

```bash
npx prisma migrate dev --name catalog_inventory_foundation --create-only
# Open the generated migration.sql and append, in this order:
#   1. The 4 partial-unique-index statements — see "Partial indexes" above.
#   2. The prevent_update_delete() function + the 2 append-only triggers — see
#      "Append-only enforcement" above.
npx prisma migrate dev            # applies the edited migration
npm run prisma:generate
npm run prisma:seed               # additive, safe to re-run
npm run db:test:migrate           # same migration, against TEST_DATABASE_URL
```

Prisma 7 no longer runs `prisma generate` automatically after `migrate dev`/`db push` — run
`npm run prisma:generate` explicitly after schema changes.

## Seed strategy

`prisma/seed.ts` (idempotent, upsert-based; run with `npm run prisma:seed`) creates **only**:

1. The 6 system roles (`isSystem: true`).
2. The full permission catalog from `src/modules/permissions/catalog.ts`.
3. Role → permission assignments (additive only — a re-seed never removes a permission an admin
   granted manually afterward; it only ensures the catalog's defaults exist).
4. The base `StoreConfiguration` row.
5. **One** initial administrator — only if `INITIAL_ADMIN_NAME`/`INITIAL_ADMIN_EMAIL`/
   `INITIAL_ADMIN_PASSWORD` are all set, created through Better Auth's own sign-up path (so the
   password is hashed exactly as Better Auth expects). If any is missing, the seed logs a clear
   message and skips admin creation — it never invents a default password.

No demo products, customers, warehouses, or test users of any kind. Those live exclusively in
`tests/fixtures/` (see `tests/fixtures/users.ts`) and `prisma/seed.ts` never imports from
`tests/`. Loading real catalog/stock data is what `/admin/imports/products` (see "Migration-
import foundation" above) is for — the seed intentionally stays scoped to what every environment
(including a brand-new production deploy) needs, and nothing store-specific.

## Local test database

`docker-compose.yml` provides a disposable Postgres 17 container for `TEST_DATABASE_URL`
(`localhost:55432`) plus Mailpit. Start with `docker compose up -d`. This is a reversible
default — a second Supabase project/branch works equally well if preferred.
