"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/modules/auth";
import {
  deleteCategoryImage,
  finalizeCategoryImageUpload,
  prepareCategoryImageUpload,
  type FinalizeCategoryImageUploadInput,
  type PrepareCategoryImageUploadInput,
} from "@/modules/categories/category-images";

// Step 1 of 2 — see modules/categories/category-images.ts's doc comment on
// prepareCategoryImageUpload for the full direct-to-storage upload design.
// Never touches the file's bytes.
export async function prepareCategoryImageUploadAction(input: PrepareCategoryImageUploadInput) {
  await requirePermission("categories.manage");
  return prepareCategoryImageUpload(input);
}

// Step 2 of 2 — called after the browser's own PUT to the signed URL from
// step 1 has already completed. Revalidates every route the category image
// is used from: the admin list/edit screens, and the public home tiles
// (see components/home/category-tiles.tsx) — /catalog too, since a future
// catalog surface may reuse the same category image.
export async function finalizeCategoryImageUploadAction(input: FinalizeCategoryImageUploadInput) {
  const actor = await requirePermission("categories.manage");
  const category = await finalizeCategoryImageUpload(input, actor.id);

  revalidatePath("/admin/categories");
  revalidatePath(`/admin/categories/${input.categoryId}`);
  revalidatePath("/");
  revalidatePath("/catalog");

  return category;
}

export async function deleteCategoryImageAction(input: { categoryId: string }) {
  const actor = await requirePermission("categories.manage");
  await deleteCategoryImage(input.categoryId, actor.id);

  revalidatePath("/admin/categories");
  revalidatePath(`/admin/categories/${input.categoryId}`);
  revalidatePath("/");
  revalidatePath("/catalog");
}
