"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { archiveCategory, createCategory, updateCategory } from "@/modules/categories/service";

const createCategorySchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  parentId: z.string().min(1).optional(),
  description: z.string().optional(),
});

export async function createCategoryAction(input: z.infer<typeof createCategorySchema>) {
  const actor = await requirePermission("categories.manage");
  const data = createCategorySchema.parse(input);
  await createCategory(
    { name: data.name, parentId: data.parentId ?? null, description: data.description ?? null },
    actor.id,
  );
  revalidatePath("/admin/categories");
}

const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  parentId: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function updateCategoryAction(input: z.infer<typeof updateCategorySchema>) {
  const actor = await requirePermission("categories.manage");
  const { id, ...data } = updateCategorySchema.parse(input);
  await updateCategory(id, data, actor.id);
  revalidatePath("/admin/categories");
}

export async function archiveCategoryAction(input: { id: string }) {
  const actor = await requirePermission("categories.manage");
  await archiveCategory(input.id, actor.id);
  revalidatePath("/admin/categories");
}
