import "server-only";

import { imageSize } from "image-size";

import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";
import { getStorageProvider } from "@/modules/storage";
import {
  buildObjectPath,
  validateImageFileSignature,
  validateUpload,
} from "@/modules/storage/validation";

const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGES_PER_PRODUCT = 10;
const MAX_IMAGE_DIMENSION_PX = 6000;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class TooManyImagesError extends Error {
  constructor() {
    super(`Un producto no puede tener más de ${MAX_IMAGES_PER_PRODUCT} imágenes.`);
    this.name = "TooManyImagesError";
  }
}

export class ImageDimensionsError extends Error {
  constructor() {
    super(`La imagen supera el máximo de ${MAX_IMAGE_DIMENSION_PX}px por lado.`);
    this.name = "ImageDimensionsError";
  }
}

export interface UploadProductImageInput {
  productId: string;
  variantId?: string | null;
  file: Buffer;
  filename: string;
  contentType: string;
  altText?: string | null;
}

// Upload-then-DB-insert with cleanup: if the DB insert fails after a
// successful storage upload, the just-uploaded object is deleted rather
// than left orphaned. The first image on a product becomes primary
// automatically; later ones don't (use setPrimaryImage explicitly).
export async function uploadProductImage(input: UploadProductImageInput, actorId: string) {
  const existingCount = await prisma.productImage.count({ where: { productId: input.productId } });
  if (existingCount >= MAX_IMAGES_PER_PRODUCT) throw new TooManyImagesError();

  validateUpload({
    filename: input.filename,
    contentType: input.contentType,
    size: input.file.byteLength,
    allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
  });
  // Validates the actual bytes, not just the declared Content-Type header.
  validateImageFileSignature(input.file, input.contentType);

  const dimensions = imageSize(input.file);
  if (dimensions.width > MAX_IMAGE_DIMENSION_PX || dimensions.height > MAX_IMAGE_DIMENSION_PX) {
    throw new ImageDimensionsError();
  }

  // Extension matches the actual stored bytes — no format conversion
  // happens this phase (no sharp; see INTEGRATIONS.md), so a JPEG upload
  // stays .jpg, never forced to .webp.
  const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType];
  const bucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
  const path = buildObjectPath("products", input.productId, extension);

  const stored = await getStorageProvider().upload({
    bucket,
    path,
    file: input.file,
    contentType: input.contentType,
  });

  try {
    const image = await prisma.productImage.create({
      data: {
        productId: input.productId,
        variantId: input.variantId ?? null,
        bucket: stored.bucket,
        path: stored.path,
        contentType: stored.contentType,
        fileSize: stored.size,
        width: dimensions.width,
        height: dimensions.height,
        altText: input.altText ?? null,
        isPrimary: existingCount === 0,
        // Each new image gets the next slot — without this, every image
        // would share the schema default (0) and "reorder" would have
        // nothing meaningful to swap. See reorderProductImage below.
        displayOrder: existingCount,
        createdById: actorId,
      },
    });

    await recordAuditLog({
      userId: actorId,
      action: "product_image.uploaded",
      entityType: "Product",
      entityId: input.productId,
      newValue: { imageId: image.id, path: image.path },
    });

    return image;
  } catch (error) {
    await getStorageProvider()
      .delete(bucket, path)
      .catch(() => {
        // Best-effort cleanup — the original DB error is what the caller
        // needs to see, not a secondary storage-cleanup failure.
      });
    throw error;
  }
}

// Deletes the DB row first: a failed storage delete afterward leaves an
// orphaned (invisible) storage object — a safer failure mode than a DB row
// pointing at an already-deleted object. The orphan is logged, a documented
// accepted gap rather than a hard guarantee (see SECURITY.md).
export async function deleteProductImage(imageId: string, actorId: string): Promise<void> {
  const image = await prisma.productImage.findUniqueOrThrow({ where: { id: imageId } });

  await prisma.productImage.delete({ where: { id: imageId } });

  try {
    await getStorageProvider().delete(image.bucket, image.path);
  } catch (error) {
    console.error("Orphaned storage object after image delete:", image.bucket, image.path, error);
  }

  await recordAuditLog({
    userId: actorId,
    action: "product_image.deleted",
    entityType: "Product",
    entityId: image.productId,
    previousValue: { imageId: image.id, path: image.path },
  });
}

// Exactly one primary image per product — same pattern as
// warehouses.setDefaultWarehouse: unset the old one, set the new one, in
// one transaction. Backed by a hand-written partial unique index
// (product_image_primary_unique; see DATABASE.md).
export async function setPrimaryImage(imageId: string, actorId: string) {
  const image = await prisma.productImage.findUniqueOrThrow({ where: { id: imageId } });

  const [, updated] = await prisma.$transaction([
    prisma.productImage.updateMany({
      where: { productId: image.productId, isPrimary: true },
      data: { isPrimary: false },
    }),
    prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
  ]);

  await recordAuditLog({
    userId: actorId,
    action: "product_image.set_primary",
    entityType: "Product",
    entityId: image.productId,
    newValue: { imageId },
  });

  return updated;
}

// Swaps this image's displayOrder with its immediate neighbor (by current
// display order) in the given direction — a no-op, not an error, if
// already at that edge (first image asked to move up, last asked to move
// down). Same "swap the two affected rows in one transaction" shape as
// setPrimaryImage/setDefaultWarehouse elsewhere in this codebase.
export async function reorderProductImage(
  imageId: string,
  direction: "up" | "down",
  actorId: string,
): Promise<void> {
  const image = await prisma.productImage.findUniqueOrThrow({ where: { id: imageId } });
  const siblings = await prisma.productImage.findMany({
    where: { productId: image.productId },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });

  const index = siblings.findIndex((sibling) => sibling.id === imageId);
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= siblings.length) return;

  const neighbor = siblings[neighborIndex];
  await prisma.$transaction([
    prisma.productImage.update({
      where: { id: image.id },
      data: { displayOrder: neighbor.displayOrder },
    }),
    prisma.productImage.update({
      where: { id: neighbor.id },
      data: { displayOrder: image.displayOrder },
    }),
  ]);

  await recordAuditLog({
    userId: actorId,
    action: "product_image.reordered",
    entityType: "Product",
    entityId: image.productId,
    newValue: { imageId, direction },
  });
}

// Uploads and commits the new image before removing the old one, per the
// explicit ordering requirement. Note: this counts against
// MAX_IMAGES_PER_PRODUCT before the old one is removed — replacing at
// exactly the cap requires deleteProductImage + uploadProductImage as two
// separate calls instead.
export async function replaceProductImage(
  oldImageId: string,
  uploadInput: UploadProductImageInput,
  actorId: string,
) {
  const oldImage = await prisma.productImage.findUniqueOrThrow({ where: { id: oldImageId } });

  const newImage = await uploadProductImage(uploadInput, actorId);
  if (oldImage.isPrimary) {
    await setPrimaryImage(newImage.id, actorId);
  }
  await deleteProductImage(oldImageId, actorId);

  return newImage;
}

export function getProductImagePublicUrl(image: { bucket: string; path: string }): string {
  return getStorageProvider().getPublicUrl(image.bucket, image.path);
}
