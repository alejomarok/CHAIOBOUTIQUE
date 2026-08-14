"use server";

import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { requirePermission } from "@/modules/auth";
import {
  deleteProductImage,
  finalizeProductImageUpload,
  getProductSlugForRevalidation,
  prepareProductImageUpload,
  reorderProductImage,
  setPrimaryImage,
  type FinalizeProductImageUploadInput,
  type PrepareProductImageUploadInput,
} from "@/modules/products/product-images";
import { getStorageProvider } from "@/modules/storage";

// Dev-only diagnostics appended to a thrown error's message: which
// provider/bucket the operation was attempting to reach, never any
// credential or secret value — the real cause is already in error.message
// (e.g. the Supabase SDK's own error text, or a validation error), this
// just adds the context that's otherwise invisible from the browser
// (provider selection happens entirely server-side — see modules/storage/
// index.ts's getStorageProvider).
async function withDevDiagnostics<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      const provider = getStorageProvider().constructor.name;
      const bucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason} [dev: provider=${provider} bucket=${bucket}]`);
    }
    throw error;
  }
}

// Step 1 of 2 — see modules/products/product-images.ts's doc comment on
// prepareProductImageUpload for the full direct-to-storage upload design.
// Returns a signed upload target; never touches the file's bytes (the
// browser hasn't sent them anywhere yet at this point).
export async function prepareProductImageUploadAction(input: PrepareProductImageUploadInput) {
  await requirePermission("product_images.manage");
  return withDevDiagnostics(() => prepareProductImageUpload(input));
}

// Step 2 of 2 — called after the browser's own PUT to the signed URL from
// step 1 has already completed. Re-checks permission independently of step
// 1 (a session could theoretically be revoked in between) and never trusts
// that the browser's upload actually succeeded or was well-formed — see
// finalizeProductImageUpload's own validation.
export async function finalizeProductImageUploadAction(input: FinalizeProductImageUploadInput) {
  const actor = await requirePermission("product_images.manage");

  const image = await withDevDiagnostics(() => finalizeProductImageUpload(input, actor.id));

  revalidatePath(`/admin/products/${input.productId}`);
  revalidatePath("/catalog");
  const slug = await getProductSlugForRevalidation(input.productId);
  if (slug) revalidatePath(`/product/${slug}`);

  return image;
}

export async function deleteProductImageAction(input: { imageId: string; productId: string }) {
  const actor = await requirePermission("product_images.manage");
  await deleteProductImage(input.imageId, actor.id);
  revalidatePath(`/admin/products/${input.productId}`);
  revalidatePath("/catalog");
  const slug = await getProductSlugForRevalidation(input.productId);
  if (slug) revalidatePath(`/product/${slug}`);
}

export async function setPrimaryImageAction(input: { imageId: string; productId: string }) {
  const actor = await requirePermission("product_images.manage");
  await setPrimaryImage(input.imageId, actor.id);
  revalidatePath(`/admin/products/${input.productId}`);
  revalidatePath("/catalog");
  const slug = await getProductSlugForRevalidation(input.productId);
  if (slug) revalidatePath(`/product/${slug}`);
}

export async function reorderProductImageAction(input: {
  imageId: string;
  productId: string;
  direction: "up" | "down";
}) {
  const actor = await requirePermission("product_images.manage");
  await reorderProductImage(input.imageId, input.direction, actor.id);
  revalidatePath(`/admin/products/${input.productId}`);
}
