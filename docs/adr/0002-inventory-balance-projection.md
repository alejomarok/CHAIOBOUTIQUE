# ADR-2: Inventory as an append-only ledger with a derived balance projection

## Status

Accepted. Governs `InventoryOperation`, `InventoryMovement`, and `InventoryBalance` in
`prisma/schema.prisma`, and every write path that touches them (`modules/inventory/service.ts`,
`modules/imports/row-processors.ts`).

## Context

Stock quantity is exactly the kind of state where a naive "just update the counter" design fails
quietly: concurrent writes can lose updates, a bug or a bad manual correction has no audit trail,
and there's no way to answer "why does this variant show 12 units" after the fact. The catalog
phase needed a real design for this before any inventory code was written.

## Decision

### InventoryOperation is the aggregate root; InventoryMovement rows are immutable facts

`InventoryOperation` is one row per business event — a manual adjustment, a transfer, an
imported initial-stock row — regardless of how many stock movements that event produces (a
transfer produces two: `TRANSFER_OUT` at the source, `TRANSFER_IN` at the destination, under one
operation, never reused `ADJUSTMENT_OUT`/`ADJUSTMENT_IN` types, so historical reporting can
always tell a transfer apart from a manual adjustment). `InventoryMovement` rows are the
immutable ledger: each carries `quantityDelta`, `previousQuantity`, and `newQuantity`, so the
ledger is self-verifying — summing `quantityDelta` for a (variant, warehouse) pair must always
equal the current `InventoryBalance.quantity` (asserted directly in
`tests/integration/inventory.test.ts`).

**No update or delete function is exposed** by `modules/inventory/service.ts` — corrections are
new, compensating movements, never edits to history. This is enforced at two levels, not one:

1. **Application level**: no `updateMovement`/`deleteMovement` exists.
2. **Database level**: a `BEFORE UPDATE OR DELETE` Postgres trigger on `inventory_movement`
   (added by hand-edited migration SQL, applied to every database role including the
   application's own connection) raises an exception on any attempt. The same trigger is applied
   to `audit_log`, which has the identical integrity requirement and where the application
   already never exposes update/delete — the trigger only blocks a path that shouldn't exist
   anyway, at zero cost to any legitimate operation.

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

**Break-glass procedure** (documented here and in [DATABASE.md](../../DATABASE.md), never
implemented in application code): if an exceptional correction is ever genuinely required, a
human with a direct superuser/service Postgres connection runs
`ALTER TABLE inventory_movement DISABLE TRIGGER inventory_movement_append_only;`, performs the
correction under manual review, then re-enables the trigger immediately. This is an explicit,
manual, out-of-band, logged DBA action — the application layer has no code path for it, by
design.

### InventoryBalance is a derived projection, written only through one guarded atomic UPDATE

`InventoryBalance.quantity` is not a second source of truth alongside the movement ledger — it's
a cache of "sum of movements so far," maintained by exactly one code path:
`applyInventoryOperation` (`modules/inventory/service.ts`) issues a single, parameterized,
guarded `UPDATE`:

```sql
UPDATE inventory_balance
SET quantity = quantity + $delta, "updatedAt" = now()
WHERE "variantId" = $variantId AND "warehouseId" = $warehouseId
  AND quantity + $delta >= 0
RETURNING quantity AS "newQuantity"
```

This is deliberately **not** a read-then-write (`SELECT` the balance, compute the new value in
application code, `UPDATE`) and **not** optimistic locking with a retry loop. A single
round-trip, guarded `UPDATE` gets Postgres's native per-row lock for the statement's duration and
the "never go negative" invariant enforced directly in the `WHERE` clause — if the clause matches
zero rows, either the balance row doesn't exist yet (handled by an `upsert` immediately before)
or the delta would take it negative, and `InsufficientStockError` is thrown. Verified directly:
`tests/integration/inventory.test.ts` fires two concurrent adjustments at the same balance row
and asserts neither update is lost.

### InventoryOperation.idempotencyKey is the real duplicate-prevention mechanism

A nullable, `@unique` column on `InventoryOperation`. `correlationId` (also present) is
**grouping-for-observability only** — e.g. tying a transfer's two movements together in logs —
and is never used for deduplication. Generation strategy per source
(`modules/inventory/idempotency.ts`):

- **Manual adjustments / transfers**: the admin form generates a UUID once when it mounts and
  resubmits the same value on every attempt. A double-click or network retry reuses the same key
  and is rejected (`DuplicateOperationError`, from a caught `P2002` on the unique column) rather
  than double-applied.
- **Imports**: `` `import:${operationType}:${sourceSystem}:${legacyId}` `` — deterministic,
  scoped to the source row's own business identity, **not** the import batch id. This is what
  makes re-uploading the same source file, or a corrected re-export containing the same row,
  safely idempotent regardless of which `ImportBatch` it lands in: the retry hits the same
  unique-constraint violation, and `modules/imports/service.ts` records it as a non-fatal
  "already imported" outcome rather than failing the row or the batch. See
  `tests/integration/imports.test.ts`'s idempotency test.
- **Future webhooks** (documented, not implemented): the provider's own delivery/event id.

### Inventory audit is written in the same transaction as the balance change — a documented, scoped exception

Every other Phase-1 mutation (`roles/service.ts`, `store-settings/service.ts`,
categories/brands/attributes CRUD) records its audit log entry **after** the triggering
transaction commits — see [ARCHITECTURE.md](../../ARCHITECTURE.md). Inventory is the one domain
where a committed-but-unaudited state change would be a real operational problem (it's
money- and stock-adjacent), so `applyInventoryOperation` writes the `InventoryOperation`, its
`InventoryMovement` row(s), and the `AuditLog` entry inside **one** `$transaction` — all-or-
nothing. `recordAuditLog` (`modules/audit/index.ts`) gained an additive, optional second
parameter for exactly this (`client: Prisma.TransactionClient | typeof prisma = prisma`),
so every other call site is unaffected.

### No nested transactions — one shared primitive, callers each open their own transaction

`applyInventoryOperation(tx, operation, movements)` takes an **already-open** transaction client
rather than opening its own. `adjustInventory()` and `transferInventory()` (the public API) each
wrap it in their own `prisma.$transaction(...)`. The per-row import pipeline
(`modules/imports/row-processors.ts`'s `processInitialStockRow`) calls
`applyInventoryOperation` directly with the transaction it already has open for that row — it
never calls `adjustInventory`/`transferInventory`, which would each try to open a second,
nested transaction.

### Online "in stock" status reads only the default warehouse

For this phase, public stock availability (`modules/products/public-queries.ts`) reads
`InventoryBalance` for the single `Warehouse` row flagged `isDefault: true` — never summed across
warehouses. No new schema field was added for this; `isDefault` (which already exists to pick the
warehouse shown as default in the admin UI) serves double duty. A dedicated
`Warehouse.isAvailableForOnlineSales` boolean becomes justified exactly when a second warehouse
that should *also* count toward online availability exists — not before, per the project's
standing rule against speculative fields.

## Consequences

- Every stock-changing code path — manual adjustment, transfer, initial-stock import — goes
  through `applyInventoryOperation`. A future purchasing/sales phase that needs to move stock
  must add its own thin wrapper (like `adjustInventory`) rather than writing to
  `InventoryBalance`/`InventoryMovement` directly.
- Reporting/analytics can always reconstruct "how did this balance get here" from
  `InventoryMovement` alone — no separate change-history table was needed.
- The append-only trigger means any future "undo" feature must be a compensating movement, never
  an edit — this is a permanent constraint of the design, not a temporary limitation.
