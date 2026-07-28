"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/modules/auth";
import {
  deleteProductImage,
  setPrimaryImage,
  uploadProductImage,
} from "@/modules/products/product-images";

export async function uploadProductImageAction(productId: string, formData: FormData) {
  const actor = await requirePermission("product_images.manage");

  const file = formData.get("file");
  const altText = formData.get("altText");
  if (!(file instanceof File)) {
    throw new Error("No se recibió ningún archivo.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  await uploadProductImage(
    {
      productId,
      file: buffer,
      filename: file.name,
      contentType: file.type,
      altText: typeof altText === "string" && altText.length > 0 ? altText : null,
    },
    actor.id,
  );

  revalidatePath(`/admin/products/${productId}`);
}

export async function deleteProductImageAction(input: { imageId: string; productId: string }) {
  const actor = await requirePermission("product_images.manage");
  await deleteProductImage(input.imageId, actor.id);
  revalidatePath(`/admin/products/${input.productId}`);
}

export async function setPrimaryImageAction(input: { imageId: string; productId: string }) {
  const actor = await requirePermission("product_images.manage");
  await setPrimaryImage(input.imageId, actor.id);
  revalidatePath(`/admin/products/${input.productId}`);
}
