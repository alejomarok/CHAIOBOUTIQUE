import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";
import type {
  InventoryMovement,
  InventoryOperation,
  InventoryOperationType,
  MovementType,
  Prisma,
} from "@/generated/prisma/client";
import { Prisma as PrismaRuntime } from "@/generated/prisma/client";

import {
  DuplicateOperationError,
  InactiveVariantError,
  InactiveWarehouseError,
  InsufficientStockError,
  InvalidQuantityError,
  SameWarehouseTransferError,
} from "./errors";

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

function isIdempotencyKeyConflict(error: unknown): boolean {
  return (
    error instanceof PrismaRuntime.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta.target as string[]).includes("idempotencyKey")
  );
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
    const rows = await tx.$queryRaw<{ newQuantity: number }[]>`
      UPDATE inventory_balance
      SET quantity = quantity + ${movementInput.quantityDelta}, "updatedAt" = now()
      WHERE "variantId" = ${movementInput.variantId}
        AND "warehouseId" = ${movementInput.warehouseId}
        AND quantity + ${movementInput.quantityDelta} >= 0
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

export async function listInventoryBalances(filters: { warehouseId?: string } = {}) {
  return prisma.inventoryBalance.findMany({
    where: { warehouseId: filters.warehouseId },
    include: {
      variant: { include: { product: true, size: true, color: true } },
      warehouse: true,
    },
    orderBy: { updatedAt: "desc" },
  });
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
