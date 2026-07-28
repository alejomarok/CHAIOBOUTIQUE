"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { createBrand, updateBrand } from "@/modules/brands/service";

const createBrandSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  description: z.string().optional(),
});

export async function createBrandAction(input: z.infer<typeof createBrandSchema>) {
  const actor = await requirePermission("brands.manage");
  const data = createBrandSchema.parse(input);
  await createBrand({ name: data.name, description: data.description ?? null }, actor.id);
  revalidatePath("/admin/brands");
}

export async function toggleBrandActiveAction(input: { id: string; isActive: boolean }) {
  const actor = await requirePermission("brands.manage");
  await updateBrand(input.id, { isActive: input.isActive }, actor.id);
  revalidatePath("/admin/brands");
}
