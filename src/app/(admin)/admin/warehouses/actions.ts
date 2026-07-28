"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import {
  createWarehouse,
  setDefaultWarehouse,
  updateWarehouse,
} from "@/modules/warehouses/service";

const createWarehouseSchema = z.object({
  code: z.string().min(1, "El código es obligatorio"),
  name: z.string().min(1, "El nombre es obligatorio"),
  description: z.string().optional(),
});

export async function createWarehouseAction(input: z.infer<typeof createWarehouseSchema>) {
  const actor = await requirePermission("warehouses.manage");
  const data = createWarehouseSchema.parse(input);
  await createWarehouse(
    { code: data.code, name: data.name, description: data.description ?? null },
    actor.id,
  );
  revalidatePath("/admin/warehouses");
}

export async function toggleWarehouseActiveAction(input: { id: string; isActive: boolean }) {
  const actor = await requirePermission("warehouses.manage");
  await updateWarehouse(input.id, { isActive: input.isActive }, actor.id);
  revalidatePath("/admin/warehouses");
}

export async function setDefaultWarehouseAction(input: { id: string }) {
  const actor = await requirePermission("warehouses.manage");
  await setDefaultWarehouse(input.id, actor.id);
  revalidatePath("/admin/warehouses");
}
