import type { InventoryReservation, Prisma, ReservationStatus } from "@/generated/prisma/client";

// Node-safe core: no "server-only" import — mirrors modules/inventory/
// service-core.ts's exact posture. Every function here takes an already-open
// `tx` (never opens its own transaction) since a reservation is always
// created/released as part of a larger Order-level transaction — see
// modules/orders/order-core.ts.
//
// SCOPE — see InventoryBalance.reservedQuantity and the Order/
// InventoryReservation models' own schema comments for the full design.
// Short version: a reservation is a COMMITMENT layered on top of physical
// stock, never itself a physical movement — it changes
// InventoryBalance.reservedQuantity only, never InventoryBalance.quantity,
// and never creates an InventoryMovement/InventoryOperation row.

export class InvalidReservationQuantityError extends Error {
  constructor(quantity: number) {
    super(`Cantidad de reserva inválida: ${quantity}.`);
    this.name = "InvalidReservationQuantityError";
  }
}

// Thrown when reserving would exceed available-to-sell stock
// (quantity - reservedQuantity) — never physical stock alone. See this
// function's own doc comment for the concurrency guarantee.
export class InsufficientAvailableStockError extends Error {
  constructor(
    public readonly productVariantId: string,
    public readonly warehouseId: string,
    public readonly requestedQuantity: number,
  ) {
    super("No hay stock suficiente disponible para reservar.");
    this.name = "InsufficientAvailableStockError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor() {
    super("Reserva de stock no encontrada.");
    this.name = "ReservationNotFoundError";
  }
}

export interface ReserveStockInput {
  orderId: string;
  productVariantId: string;
  warehouseId: string;
  quantity: number;
  expiresAt: Date;
}

// Atomically reserves `quantity` units of one variant in one warehouse and
// records the commitment as an ACTIVE InventoryReservation row. Mirrors
// modules/inventory/service-core.ts's applyInventoryOperation exact idiom —
// a single parameterized, guarded UPDATE (never SELECT-then-UPDATE), relying
// on Postgres's native per-row lock for the statement's duration rather than
// optimistic-locking-with-retry.
//
// Concurrency: two concurrent reservation attempts against the SAME
// (variantId, warehouseId) — e.g. two different customers checking out the
// last unit simultaneously — are serialized by Postgres's row lock on the
// UPDATE statement itself: whichever transaction's UPDATE executes first
// wins the lock and commits; the second blocks until the first
// commits/rolls back, then its own WHERE clause re-evaluates against the
// now-current (post-commit) reservedQuantity. Only one can succeed when
// exactly one unit remains — the loser gets InsufficientAvailableStockError,
// and (since this runs inside the caller's Order-creation transaction) that
// caller's entire transaction rolls back: no Order is created with only
// some of its items reserved.
//
// No upsert-if-missing step (unlike applyInventoryOperation): a reservation
// only ever DECREASES available-to-sell against EXISTING physical stock —
// a variant with no InventoryBalance row at all correctly has 0 available,
// which this guard already rejects (0 matching rows), with no need to
// materialize a zero-quantity balance row just to reserve against it.
export async function reserveStock(
  tx: Prisma.TransactionClient,
  input: ReserveStockInput,
): Promise<InventoryReservation> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new InvalidReservationQuantityError(input.quantity);
  }

  const rows = await tx.$queryRaw<{ reservedQuantity: number }[]>`
    UPDATE inventory_balance
    SET "reservedQuantity" = "reservedQuantity" + ${input.quantity}, "updatedAt" = now()
    WHERE "variantId" = ${input.productVariantId}
      AND "warehouseId" = ${input.warehouseId}
      AND quantity - "reservedQuantity" - ${input.quantity} >= 0
    RETURNING "reservedQuantity"
  `;

  if (rows.length === 0) {
    throw new InsufficientAvailableStockError(input.productVariantId, input.warehouseId, input.quantity);
  }

  return tx.inventoryReservation.create({
    data: {
      orderId: input.orderId,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      status: "ACTIVE",
      expiresAt: input.expiresAt,
    },
  });
}

type ReleaseTargetStatus = Extract<ReservationStatus, "RELEASED" | "EXPIRED" | "CONSUMED">;

// Releases one ACTIVE reservation — decrementing InventoryBalance.
// reservedQuantity by exactly the reserved amount and marking the row with
// `toStatus` (never deleted — same "append + a status flag over destructive
// edit" posture as SalePayment's void). Idempotent: releasing an
// already-released/expired/consumed reservation is a safe no-op that
// returns the row unchanged, never a second decrement.
//
// Concurrency: the status transition itself is the guard — `updateMany`
// with `WHERE id = ... AND status = 'ACTIVE'` can only ever affect a row
// once; Postgres's row lock during that UPDATE serializes two concurrent
// release attempts on the SAME reservation (e.g. an admin cancellation
// racing the expiration sweep), and the loser's `count` comes back 0,
// skipping the reservedQuantity decrement entirely. This is what makes "no
// double release" hold even under a genuine race, not just in the common
// sequential case.
export async function releaseReservation(
  tx: Prisma.TransactionClient,
  reservationId: string,
  toStatus: ReleaseTargetStatus,
): Promise<InventoryReservation> {
  const existing = await tx.inventoryReservation.findUnique({ where: { id: reservationId } });
  if (!existing) throw new ReservationNotFoundError();

  const now = new Date();
  const result = await tx.inventoryReservation.updateMany({
    where: { id: reservationId, status: "ACTIVE" },
    data:
      toStatus === "CONSUMED"
        ? { status: toStatus, consumedAt: now }
        : { status: toStatus, releasedAt: now },
  });

  if (result.count > 0) {
    await tx.$queryRaw`
      UPDATE inventory_balance
      SET "reservedQuantity" = "reservedQuantity" - ${existing.quantity}, "updatedAt" = now()
      WHERE "variantId" = ${existing.productVariantId} AND "warehouseId" = ${existing.warehouseId}
    `;
  }

  return tx.inventoryReservation.findUniqueOrThrow({ where: { id: reservationId } });
}

// Batch release — every ACTIVE reservation for one Order, e.g. on admin
// cancellation or expiration. Same idempotency/concurrency guarantee as
// releaseReservation per row (each row's own guarded status transition),
// just looped for convenience — never a single blanket UPDATE across rows,
// since each one must independently decrement its own variant/warehouse's
// reservedQuantity by its own (possibly different) quantity.
export async function releaseAllActiveReservationsForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  toStatus: ReleaseTargetStatus,
): Promise<InventoryReservation[]> {
  const active = await tx.inventoryReservation.findMany({
    where: { orderId, status: "ACTIVE" },
  });
  const released: InventoryReservation[] = [];
  for (const reservation of active) {
    released.push(await releaseReservation(tx, reservation.id, toStatus));
  }
  return released;
}
