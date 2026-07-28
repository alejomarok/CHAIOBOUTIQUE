"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { adjustInventory, transferInventory } from "@/modules/inventory/service";

const ADJUSTMENT_MOVEMENT_TYPES = [
  "INITIAL_STOCK",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "DAMAGE",
  "LOSS",
  "INTERNAL_CORRECTION",
] as const;

const adjustSchema = z.object({
  variantId: z.string().min(1, "Elegí una variante"),
  warehouseId: z.string().min(1, "Elegí un depósito"),
  movementType: z.enum(ADJUSTMENT_MOVEMENT_TYPES),
  quantity: z.number().int().positive("La cantidad debe ser mayor a cero"),
  reason: z.string().min(1, "El motivo es obligatorio"),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

const OUTBOUND_TYPES = new Set(["ADJUSTMENT_OUT", "DAMAGE", "LOSS"]);

export async function createAdjustmentAction(input: z.infer<typeof adjustSchema>) {
  const actor = await requirePermission("stock.adjust");
  const data = adjustSchema.parse(input);

  const quantityDelta = OUTBOUND_TYPES.has(data.movementType) ? -data.quantity : data.quantity;

  await adjustInventory({
    variantId: data.variantId,
    warehouseId: data.warehouseId,
    quantityDelta,
    movementType: data.movementType,
    reason: data.reason,
    notes: data.notes,
    actorId: actor.id,
    idempotencyKey: data.idempotencyKey,
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
}

const transferSchema = z.object({
  variantId: z.string().min(1, "Elegí una variante"),
  fromWarehouseId: z.string().min(1, "Elegí el depósito de origen"),
  toWarehouseId: z.string().min(1, "Elegí el depósito de destino"),
  quantity: z.number().int().positive("La cantidad debe ser mayor a cero"),
  reason: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

export async function createTransferAction(input: z.infer<typeof transferSchema>) {
  const actor = await requirePermission("stock.transfer");
  const data = transferSchema.parse(input);

  await transferInventory({
    variantId: data.variantId,
    fromWarehouseId: data.fromWarehouseId,
    toWarehouseId: data.toWarehouseId,
    quantity: data.quantity,
    reason: data.reason,
    actorId: actor.id,
    idempotencyKey: data.idempotencyKey,
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
}
