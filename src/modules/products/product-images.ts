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
// The file actually written to storage — after client-side optimization
// (see components/.../product-images-manager.tsx's resize step, target
// long edge ~1800-2000px), a real product photo normally lands well under
// this. Checked both client-side (before upload) and here (server-side,
// against the real downloaded bytes) — never trust the client alone. This
// is deliberately the same 5 MB the product previously documented, not a
// new, larger number: the point of the client-side optimization step is
// that legitimate photos fit comfortably under it, not that the limit
// itself needed to grow.
const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024;

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

export class ProductNotFoundForImageError extends Error {
  constructor() {
    super("Producto no encontrado.");
    this.name = "ProductNotFoundForImageError";
  }
}

export class InvalidImagePathError extends Error {
  constructor() {
    super("La ruta del archivo no es válida para este producto.");
    this.name = "InvalidImagePathError";
  }
}

async function assertProductExists(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw new ProductNotFoundForImageError();
}

export interface PrepareProductImageUploadInput {
  productId: string;
  filename: string;
  contentType: string;
  fileSize: number;
}

export interface PrepareProductImageUploadResult {
  bucket: string;
  path: string;
  signedUrl: string;
  token: string;
}

// Step 1 of 2 (direct-to-storage upload — see ARCHITECTURE.md "Product
// image upload"): authorizes the upload and hands back a short-lived,
// path-scoped Supabase signed-upload URL. The file's bytes never pass
// through this server — the browser PUTs them straight to Supabase Storage
// after this returns. The object path is always generated here
// (buildObjectPath), never accepted from the caller, so a client can never
// choose where its upload lands or overwrite another product's object.
export async function prepareProductImageUpload(
  input: PrepareProductImageUploadInput,
): Promise<PrepareProductImageUploadResult> {
  await assertProductExists(input.productId);

  const existingCount = await prisma.productImage.count({ where: { productId: input.productId } });
  if (existingCount >= MAX_IMAGES_PER_PRODUCT) throw new TooManyImagesError();

  // Re-validates what the client already checked before offering the file
  // picker result — the client-side check is a UX convenience, this one is
  // the actual boundary.
  validateUpload({
    filename: input.filename,
    contentType: input.contentType,
    size: input.fileSize,
    allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    maxSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
  });

  const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType];
  const bucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
  const path = buildObjectPath("products", input.productId, extension);

  const target = await getStorageProvider().createSignedUploadUrl(bucket, path);
  return { bucket: target.bucket, path: target.path, signedUrl: target.signedUrl, token: target.token };
}

export interface FinalizeProductImageUploadInput {
  productId: string;
  bucket: string;
  path: string;
  contentType: string;
  altText?: string | null;
}

// Step 2 of 2: called after the browser's own PUT to the signed URL
// succeeds. Never trusts that success claim at face value — downloads the
// actual object back and validates it exactly as the old single-step flow
// validated a server-received buffer (file signature, dimensions), then
// creates the ProductImage row. If DB creation fails after this point, the
// just-uploaded object is deleted rather than left orphaned (mirrors the
// old uploadProductImage's own cleanup). Width/height are always derived
// from the downloaded bytes here, never accepted from the caller — a
// client-reported dimension is a UX hint at resize time, never the
// authoritative stored value.
export async function finalizeProductImageUpload(
  input: FinalizeProductImageUploadInput,
  actorId: string,
) {
  await assertProductExists(input.productId);

  const expectedBucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
  const expectedPrefix = `products/${input.productId}/`;
  const pathSuffix = input.path.startsWith(expectedPrefix) ? input.path.slice(expectedPrefix.length) : null;
  // Must be exactly {uuid}.{ext} inside this product's own folder — the
  // same shape buildObjectPath generates in prepareProductImageUpload.
  // Rejects a client that echoes back a different product's path, a
  // hand-crafted path, or path-traversal characters.
  const isWellFormedPath =
    pathSuffix !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i.test(
      pathSuffix,
    );
  if (input.bucket !== expectedBucket || !isWellFormedPath) {
    throw new InvalidImagePathError();
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(input.contentType)) {
    throw new InvalidImagePathError();
  }

  // The server never saw these bytes in transit (the browser uploaded
  // directly to Supabase) — this is the one point that actually inspects
  // them, matching the same file-signature check the old flow ran before
  // ever writing to storage.
  const bytes = await getStorageProvider().download(input.bucket, input.path);

  try {
    validateImageFileSignature(bytes, input.contentType);

    if (bytes.byteLength > MAX_UPLOAD_FILE_SIZE_BYTES) {
      throw new Error("El archivo subido supera el tamaño máximo permitido.");
    }

    const dimensions = imageSize(bytes);
    if (dimensions.width > MAX_IMAGE_DIMENSION_PX || dimensions.height > MAX_IMAGE_DIMENSION_PX) {
      throw new ImageDimensionsError();
    }

    const existingCount = await prisma.productImage.count({ where: { productId: input.productId } });
    if (existingCount >= MAX_IMAGES_PER_PRODUCT) throw new TooManyImagesError();

    try {
      const image = await prisma.productImage.create({
        data: {
          productId: input.productId,
          bucket: input.bucket,
          path: input.path,
          contentType: input.contentType,
          fileSize: bytes.byteLength,
          width: dimensions.width,
          height: dimensions.height,
          altText: input.altText ?? null,
          isPrimary: existingCount === 0,
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
    } catch (dbError) {
      // Storage succeeded, DB failed: never leave the object orphaned and
      // invisible — clean it up. If the cleanup itself fails, that's logged
      // (not swallowed) rather than pretending the operation fully
      // succeeded — see deleteProductImage's own cleanup for the same
      // posture in the other direction.
      await getStorageProvider()
        .delete(input.bucket, input.path)
        .catch((cleanupError) => {
          console.error(
            "Orphaned storage object after failed ProductImage creation:",
            input.bucket,
            input.path,
            cleanupError,
          );
        });
      throw dbError;
    }
  } catch (validationError) {
    // Validation itself failed (bad signature, oversized, wrong
    // dimensions) — the uploaded object is invalid and must not linger in
    // storage with no DB row ever pointing at it.
    await getStorageProvider()
      .delete(input.bucket, input.path)
      .catch(() => {
        // Best-effort — the original validation error is what the caller
        // needs to see.
      });
    throw validationError;
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

export function getProductImagePublicUrl(image: { bucket: string; path: string }): string {
  return getStorageProvider().getPublicUrl(image.bucket, image.path);
}

// A light, slug-only lookup for revalidatePath(`/product/${slug}`) call
// sites — never the full getProductById (which loads variants/images/etc.
// this caller never needs).
export async function getProductSlugForRevalidation(productId: string): Promise<string | null> {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { slug: true } });
  return product?.slug ?? null;
}
