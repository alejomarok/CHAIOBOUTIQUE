import "server-only";

import { imageSize } from "image-size";

import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";
import { getStorageProvider } from "@/modules/storage";
import { buildObjectPath, validateImageFileSignature, validateUpload } from "@/modules/storage/validation";

// Mirrors modules/products/product-images.ts's exact direct-to-storage
// upload architecture (see that file's own doc comments and SECURITY.md's
// "File upload validation" section) — same allowlist/size/dimension limits,
// same "server always generates the path, always re-validates the actual
// downloaded bytes" posture. The one structural difference: a Category has
// AT MOST ONE image (not a list), so this module additionally owns the
// "replace" ordering the product-images flow never needed — see
// finalizeCategoryImageUpload's own comment for the exact sequence.
const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_DIMENSION_PX = 6000;
const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class CategoryNotFoundForImageError extends Error {
  constructor() {
    super("Categoría no encontrada.");
    this.name = "CategoryNotFoundForImageError";
  }
}

export class CategoryImageDimensionsError extends Error {
  constructor() {
    super(`La imagen supera el máximo de ${MAX_IMAGE_DIMENSION_PX}px por lado.`);
    this.name = "CategoryImageDimensionsError";
  }
}

export class InvalidCategoryImagePathError extends Error {
  constructor() {
    super("La ruta del archivo no es válida para esta categoría.");
    this.name = "InvalidCategoryImagePathError";
  }
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!category) throw new CategoryNotFoundForImageError();
}

export interface PrepareCategoryImageUploadInput {
  categoryId: string;
  filename: string;
  contentType: string;
  fileSize: number;
}

export interface PrepareCategoryImageUploadResult {
  bucket: string;
  path: string;
  signedUrl: string;
  token: string;
}

// Step 1 of 2 — authorizes the upload and hands back a short-lived,
// path-scoped Supabase signed-upload URL; the file's bytes never pass
// through this server. The object path is always server-generated
// (buildObjectPath("categories", categoryId, extension)), never accepted
// from the caller, so a client can never choose where its upload lands or
// overwrite a different category's object. Reuses
// SUPABASE_PRODUCT_IMAGES_BUCKET — the existing image bucket, no
// architectural reason for a second one just for categories (see this
// phase's own "use the existing Supabase image bucket" instruction).
export async function prepareCategoryImageUpload(
  input: PrepareCategoryImageUploadInput,
): Promise<PrepareCategoryImageUploadResult> {
  await assertCategoryExists(input.categoryId);

  validateUpload({
    filename: input.filename,
    contentType: input.contentType,
    size: input.fileSize,
    allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    maxSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES,
  });

  const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType];
  const bucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
  const path = buildObjectPath("categories", input.categoryId, extension);

  const target = await getStorageProvider().createSignedUploadUrl(bucket, path);
  return { bucket: target.bucket, path: target.path, signedUrl: target.signedUrl, token: target.token };
}

export interface FinalizeCategoryImageUploadInput {
  categoryId: string;
  bucket: string;
  path: string;
  contentType: string;
  altText?: string | null;
}

// Step 2 of 2 — called after the browser's own PUT to the signed URL
// succeeds. Never trusts that success claim at face value: downloads the
// actual object back and validates it (file signature, dimensions) exactly
// like finalizeProductImageUpload does.
//
// Replace ordering (this phase's explicit requirement, since a Category can
// have at most one image, unlike a Product's list):
//   1. Upload already happened (the caller's browser PUT, before this runs).
//   2. Validate the new object's actual bytes.
//   3. Update the DB to point at the new bucket/path — ONLY once this
//      succeeds is the new image "live". If this step throws, the
//      newly-uploaded object is an orphan and is deleted (mirrors
//      finalizeProductImageUpload's own DB-failure cleanup).
//   4. Only AFTER the DB safely points to the new image: best-effort delete
//      the OLD object (if this was a replace, not a first-time upload).
// This ordering means the DB can never end up pointing at a deleted
// object, and a failed old-object delete never blocks the visible result —
// it's logged, the same accepted-gap posture as deleteProductImage.
export async function finalizeCategoryImageUpload(
  input: FinalizeCategoryImageUploadInput,
  actorId: string,
) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, imageBucket: true, imagePath: true },
  });
  if (!category) throw new CategoryNotFoundForImageError();

  const expectedBucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
  const expectedPrefix = `categories/${input.categoryId}/`;
  const pathSuffix = input.path.startsWith(expectedPrefix) ? input.path.slice(expectedPrefix.length) : null;
  const isWellFormedPath =
    pathSuffix !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i.test(pathSuffix);
  if (input.bucket !== expectedBucket || !isWellFormedPath) {
    throw new InvalidCategoryImagePathError();
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(input.contentType)) {
    throw new InvalidCategoryImagePathError();
  }

  const bytes = await getStorageProvider().download(input.bucket, input.path);

  try {
    validateImageFileSignature(bytes, input.contentType);

    if (bytes.byteLength > MAX_UPLOAD_FILE_SIZE_BYTES) {
      throw new Error("El archivo subido supera el tamaño máximo permitido.");
    }

    const dimensions = imageSize(bytes);
    if (dimensions.width > MAX_IMAGE_DIMENSION_PX || dimensions.height > MAX_IMAGE_DIMENSION_PX) {
      throw new CategoryImageDimensionsError();
    }

    const previousBucket = category.imageBucket;
    const previousPath = category.imagePath;

    let updated;
    try {
      updated = await prisma.category.update({
        where: { id: input.categoryId },
        data: {
          imageBucket: input.bucket,
          imagePath: input.path,
          imageAltText: input.altText ?? null,
        },
      });
    } catch (dbError) {
      // DB update failed — the just-uploaded object is an orphan (the
      // category still points at whatever it pointed at before, if
      // anything). Never leave it invisible in storage.
      await getStorageProvider()
        .delete(input.bucket, input.path)
        .catch((cleanupError) => {
          console.error(
            "Orphaned storage object after failed Category image update:",
            input.bucket,
            input.path,
            cleanupError,
          );
        });
      throw dbError;
    }

    // Only now, with the DB safely pointing at the new image, remove the
    // OLD object if this was a replace — best-effort, never blocking or
    // reverting the already-successful update.
    if (previousBucket && previousPath && (previousBucket !== input.bucket || previousPath !== input.path)) {
      await getStorageProvider()
        .delete(previousBucket, previousPath)
        .catch((cleanupError) => {
          console.error(
            "Orphaned OLD storage object after Category image replace:",
            previousBucket,
            previousPath,
            cleanupError,
          );
        });
    }

    await recordAuditLog({
      userId: actorId,
      action: "category_image.uploaded",
      entityType: "Category",
      entityId: input.categoryId,
      newValue: { bucket: updated.imageBucket, path: updated.imagePath },
    });

    return updated;
  } catch (validationError) {
    // Validation itself failed — the uploaded object is invalid and must
    // not linger in storage with nothing pointing at it.
    await getStorageProvider()
      .delete(input.bucket, input.path)
      .catch(() => {
        // Best-effort — the original validation error is what the caller
        // needs to see.
      });
    throw validationError;
  }
}

// Clears the DB reference FIRST, then deletes the storage object
// best-effort — the DB must never be left pointing at an object that was
// already deleted (this phase's explicit ordering requirement; the inverse
// of finalize's own "DB only after storage" ordering, and deliberately so:
// here the DB row is the thing customers' page renders read, so it must
// stop pointing at the object before the object itself might disappear).
export async function deleteCategoryImage(categoryId: string, actorId: string): Promise<void> {
  const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
  if (!category.imageBucket || !category.imagePath) return;

  const { imageBucket, imagePath } = category;

  await prisma.category.update({
    where: { id: categoryId },
    data: { imageBucket: null, imagePath: null, imageAltText: null },
  });

  try {
    await getStorageProvider().delete(imageBucket, imagePath);
  } catch (error) {
    console.error("Orphaned storage object after Category image delete:", imageBucket, imagePath, error);
  }

  await recordAuditLog({
    userId: actorId,
    action: "category_image.deleted",
    entityType: "Category",
    entityId: categoryId,
    previousValue: { bucket: imageBucket, path: imagePath },
  });
}

export function getCategoryImagePublicUrl(image: { imageBucket: string; imagePath: string }): string {
  return getStorageProvider().getPublicUrl(image.imageBucket, image.imagePath);
}
