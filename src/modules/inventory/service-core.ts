import { prisma } from "@/lib/db-core";
import { timed } from "@/lib/timing";
import { recordAuditLog } from "@/modules/audit/index-core";
import { Prisma } from "@/generated/prisma/client";
import type {
  InventoryMovement,
  InventoryOperation,
  InventoryOperationType,
  MovementType,
} from "@/generated/prisma/client";

import {
  DuplicateOperationError,
  InactiveVariantError,
  InactiveWarehouseError,
  InsufficientStockError,
  InvalidQuantityError,
  SameWarehouseTransferError,
} from "./errors";
import { isIdempotencyKeyConflict } from "./idempotency";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) so this stays
// importable from a plain Node context (Playwright's test-runner process) —
// see src/modules/inventory/service.ts and ARCHITECTURE.md.

export interface MovementInput {
  variantId: string;
  warehouseId: string;
  movementType: MovementType;
  quantityDelta: number;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface CreateOperationInput {
  operationType: InventoryOperationType;
  idempotencyKey?: string | null;
  correlationId?: string;
  actorId: string;
  reason?: string | null;
  notes?: string | null;
  importBatchId?: string | null;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
}

export interface ApplyInventoryOperationResult {
  operation: InventoryOperation;
  movements: InventoryMovement[];
}

// The one transaction-aware primitive every inventory write goes through —
// takes an already-open `tx` rather than opening its own, specifically so
// callers that need multiple movements atomic with other work (transfers;
// the per-row import pipeline in Phase 2D) never nest transactions. Public
// callers should normally use adjustInventory()/transferInventory() below;
// this is exported for the import pipeline, which supplies its own per-row
// `tx`.
export async function applyInventoryOperation(
  tx: Prisma.TransactionClient,
  operationInput: CreateOperationInput,
  movementInputs: MovementInput[],
): Promise<ApplyInventoryOperationResult> {
  for (const movement of movementInputs) {
    if (!Number.isInteger(movement.quantityDelta) || movement.quantityDelta === 0) {
      throw new InvalidQuantityError(movement.quantityDelta);
    }
  }

  const variantIds = [...new Set(movementInputs.map((m) => m.variantId))];
  const warehouseIds = [...new Set(movementInputs.map((m) => m.warehouseId))];

  const [variants, warehouses] = await Promise.all([
    tx.productVariant.findMany({ where: { id: { in: variantIds } } }),
    tx.warehouse.findMany({ where: { id: { in: warehouseIds } } }),
  ]);

  for (const movement of movementInputs) {
    const variant = variants.find((v) => v.id === movement.variantId);
    if (!variant || !variant.isActive) throw new InactiveVariantError(movement.variantId);
    const warehouse = warehouses.find((w) => w.id === movement.warehouseId);
    if (!warehouse || !warehouse.isActive) throw new InactiveWarehouseError(movement.warehouseId);
  }

  const correlationId = operationInput.correlationId ?? crypto.randomUUID();

  let operation: InventoryOperation;
  try {
    operation = await tx.inventoryOperation.create({
      data: {
        operationType: operationInput.operationType,
        idempotencyKey: operationInput.idempotencyKey ?? null,
        correlationId,
        actorId: operationInput.actorId,
        reason: operationInput.reason ?? null,
        notes: operationInput.notes ?? null,
        importBatchId: operationInput.importBatchId ?? null,
        metadata: operationInput.metadata ?? undefined,
        occurredAt: operationInput.occurredAt ?? new Date(),
      },
    });
  } catch (error) {
    if (isIdempotencyKeyConflict(error)) {
      throw new DuplicateOperationError(operationInput.idempotencyKey ?? "");
    }
    throw error;
  }

  const movements: InventoryMovement[] = [];

  for (const movementInput of movementInputs) {
    // Ensures the row exists (quantity 0) before the guarded increment below
    // — a no-op update when it already does.
    await tx.inventoryBalance.upsert({
      where: {
        variantId_warehouseId: {
          variantId: movementInput.variantId,
          warehouseId: movementInput.warehouseId,
        },
      },
      create: {
        variantId: movementInput.variantId,
        warehouseId: movementInput.warehouseId,
        quantity: 0,
      },
      update: {},
    });

    // The concurrency mechanism: a single atomic, parameterized, guarded
    // UPDATE — not read-then-write, not optimistic-locking-with-retry. One
    // round trip, Postgres's native per-row lock for the statement's
    // duration, and the "never go negative" guard directly in the WHERE
    // clause. See docs/adr/0002-inventory-balance-projection.md.
    //
    // Phase — Online Orders & Checkout foundation. A SALE movement's guard
    // is stricter than every other movement type: it must never go below
    // ZERO AVAILABLE-TO-SELL (quantity - reservedQuantity), not merely
    // never below zero PHYSICAL stock — otherwise a POS sale could consume
    // units already committed to an ACTIVE online-Order reservation (see
    // InventoryBalance.reservedQuantity's schema comment and this phase's
    // explicit "POS must not oversell into a reservation" requirement).
    // Every other movement type (adjustments, transfers, imports,
    // SALE_CANCELLATION's restoring +delta, ...) keeps the exact original
    // guard — byte-identical behavior, not just "unaffected in practice".
    const guard =
      movementInput.movementType === "SALE"
        ? Prisma.sql`quantity - "reservedQuantity" + ${movementInput.quantityDelta} >= 0`
        : Prisma.sql`quantity + ${movementInput.quantityDelta} >= 0`;

    const rows = await tx.$queryRaw<{ newQuantity: number }[]>`
      UPDATE inventory_balance
      SET quantity = quantity + ${movementInput.quantityDelta}, "updatedAt" = now()
      WHERE "variantId" = ${movementInput.variantId}
        AND "warehouseId" = ${movementInput.warehouseId}
        AND ${guard}
      RETURNING quantity AS "newQuantity"
    `;

    if (rows.length === 0) {
      throw new InsufficientStockError(
        movementInput.variantId,
        movementInput.warehouseId,
        movementInput.quantityDelta,
      );
    }

    const newQuantity = rows[0].newQuantity;
    const previousQuantity = newQuantity - movementInput.quantityDelta;

    const movement = await tx.inventoryMovement.create({
      data: {
        operationId: operation.id,
        variantId: movementInput.variantId,
        warehouseId: movementInput.warehouseId,
        movementType: movementInput.movementType,
        quantityDelta: movementInput.quantityDelta,
        previousQuantity,
        newQuantity,
        relatedEntityType: movementInput.relatedEntityType ?? null,
        relatedEntityId: movementInput.relatedEntityId ?? null,
      },
    });

    movements.push(movement);
  }

  // Same transaction as the balance/movement change — an all-or-nothing
  // unit for inventory specifically (a scoped exception to the
  // after-commit audit pattern used elsewhere; see ARCHITECTURE.md).
  await recordAuditLog(
    {
      userId: operationInput.actorId,
      action: "inventory.operation_applied",
      entityType: "InventoryOperation",
      entityId: operation.id,
      newValue: {
        operationType: operation.operationType,
        movements: movements.map((m) => ({
          variantId: m.variantId,
          warehouseId: m.warehouseId,
          movementType: m.movementType,
          quantityDelta: m.quantityDelta,
          previousQuantity: m.previousQuantity,
          newQuantity: m.newQuantity,
        })),
      },
      correlationId,
    },
    tx,
  );

  return { operation, movements };
}

function inferOperationType(movementType: MovementType): InventoryOperationType {
  switch (movementType) {
    case "INITIAL_STOCK":
      return "INITIAL_STOCK";
    case "INTERNAL_CORRECTION":
      return "INTERNAL_CORRECTION";
    default:
      return "MANUAL_ADJUSTMENT";
  }
}

export interface AdjustInventoryInput {
  variantId: string;
  warehouseId: string;
  quantityDelta: number;
  movementType: Extract<
    MovementType,
    "INITIAL_STOCK" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "DAMAGE" | "LOSS" | "INTERNAL_CORRECTION"
  >;
  reason?: string;
  notes?: string;
  actorId: string;
  idempotencyKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  occurredAt?: Date;
}

// Manual adjustment / initial stock / internal correction — a single
// movement. idempotencyKey should be a client-generated UUID for admin-form
// submissions (see modules/inventory/idempotency.ts).
export async function adjustInventory(
  input: AdjustInventoryInput,
): Promise<ApplyInventoryOperationResult> {
  return prisma.$transaction((tx) =>
    applyInventoryOperation(
      tx,
      {
        operationType: inferOperationType(input.movementType),
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        reason: input.reason,
        notes: input.notes,
        occurredAt: input.occurredAt,
      },
      [
        {
          variantId: input.variantId,
          warehouseId: input.warehouseId,
          movementType: input.movementType,
          quantityDelta: input.quantityDelta,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
        },
      ],
    ),
  );
}

export interface TransferInventoryInput {
  variantId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  reason?: string;
  notes?: string;
  actorId: string;
  idempotencyKey?: string;
  occurredAt?: Date;
}

// One InventoryOperation (operationType: TRANSFER), two real, distinct
// movements — TRANSFER_OUT at the source, TRANSFER_IN at the destination —
// never ADJUSTMENT_OUT/ADJUSTMENT_IN, so historical reporting can always
// tell a transfer apart from a manual adjustment.
export async function transferInventory(
  input: TransferInventoryInput,
): Promise<ApplyInventoryOperationResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new InvalidQuantityError(input.quantity);
  }
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new SameWarehouseTransferError();
  }

  return prisma.$transaction((tx) =>
    applyInventoryOperation(
      tx,
      {
        operationType: "TRANSFER",
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        reason: input.reason,
        notes: input.notes,
        occurredAt: input.occurredAt,
      },
      [
        {
          variantId: input.variantId,
          warehouseId: input.fromWarehouseId,
          movementType: "TRANSFER_OUT",
          quantityDelta: -input.quantity,
        },
        {
          variantId: input.variantId,
          warehouseId: input.toWarehouseId,
          movementType: "TRANSFER_IN",
          quantityDelta: input.quantity,
        },
      ],
    ),
  );
}

export async function getInventoryBalance(variantId: string, warehouseId: string) {
  return prisma.inventoryBalance.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId } },
  });
}

// =============================================================================
// Phase — Online Orders & Checkout foundation. "Available to sell" —
// InventoryBalance.quantity - InventoryBalance.reservedQuantity, floored at
// 0 for display (should never actually go negative given
// applyInventoryOperation's/reserveStock's guards, but a read path must
// never surface a negative number even in the face of an unforeseen bug
// elsewhere). This is THE ONE formula every availability-sensitive read
// path uses — cart validation (modules/cart/service.ts), public product
// stock status (modules/products/public-queries.ts), checkout reservation
// creation (modules/inventory/reservation-core.ts), and the POS sale
// builder's "Disponible: N" (modules/sales/sale-core.ts) — never a second,
// independently-computed notion of "available".
// =============================================================================

export async function getAvailableToSell(variantId: string, warehouseId: string): Promise<number> {
  const balance = await getInventoryBalance(variantId, warehouseId);
  if (!balance) return 0;
  const available = balance.quantity - balance.reservedQuantity;
  return available > 0 ? available : 0;
}

// Batch equivalent of getAvailableToSell, scoped to ONE warehouse (every
// caller of this — cart, checkout, POS — already only ever cares about a
// single fulfillment warehouse at a time; see getDefaultWarehouse's own
// "single warehouse public stock reads from" posture) — one query
// regardless of variant count, never N+1.
export async function getAvailableToSellForVariants(
  variantIds: string[],
  warehouseId: string,
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const balances = await prisma.inventoryBalance.findMany({
    where: { warehouseId, variantId: { in: variantIds } },
  });
  return new Map(
    balances.map((balance) => {
      const available = balance.quantity - balance.reservedQuantity;
      return [balance.variantId, available > 0 ? available : 0];
    }),
  );
}

// Total stock across every warehouse for a set of variants — used by the
// admin product detail page's "Visibilidad pública" summary, which cares
// about "is there any stock at all" rather than a per-warehouse breakdown
// (that detail lives on /admin/inventory). Never used for a write/guard
// decision — adjustInventory's own atomic per-(variant, warehouse) update
// is the only place stock correctness is actually enforced.
export async function getTotalStockForVariants(variantIds: string[]): Promise<number> {
  if (variantIds.length === 0) return 0;
  return timed("inventory.getTotalStockForVariants", async () => {
    const result = await prisma.inventoryBalance.aggregate({
      where: { variantId: { in: variantIds } },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  });
}

// The batch/list-page equivalent of getTotalStockForVariants: one query for
// every variant across every product on /admin/products, returned as a
// variantId -> total-stock map so the caller groups by product itself —
// never one query per row (that would be exactly the N+1 pattern this
// codebase's product/catalog read paths deliberately avoid elsewhere).
export async function getStockByVariantIds(variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await prisma.inventoryBalance.groupBy({
    by: ["variantId"],
    where: { variantId: { in: variantIds } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.variantId, row._sum.quantity ?? 0]));
}

export async function listInventoryBalances(
  filters: { warehouseId?: string; variantIds?: string[] } = {},
) {
  return timed("inventory.listInventoryBalances", () =>
    prisma.inventoryBalance.findMany({
      where: {
        warehouseId: filters.warehouseId,
        variantId: filters.variantIds ? { in: filters.variantIds } : undefined,
      },
      include: {
        variant: { include: { product: true, sizeOption: true, color: true } },
        warehouse: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  );
}

export async function listInventoryMovements(filters: {
  variantId?: string;
  warehouseId?: string;
  take?: number;
}) {
  return prisma.inventoryMovement.findMany({
    where: { variantId: filters.variantId, warehouseId: filters.warehouseId },
    include: { operation: { select: { operationType: true, actorId: true, reason: true } } },
    orderBy: { createdAt: "desc" },
    take: filters.take ?? 100,
  });
}

export * from "./errors";
