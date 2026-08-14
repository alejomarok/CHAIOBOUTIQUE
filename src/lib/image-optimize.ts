// Browser-only image validation + optimization for product image upload —
// see the "direct signed upload" architecture in modules/products/
// product-images.ts. Runs entirely client-side before any network call: a
// typical multi-megapixel phone photo is resized/re-compressed here to a
// file normally well under a megabyte, so the upload itself is fast and
// comfortably inside the server-side MAX_UPLOAD_FILE_SIZE_BYTES check.
//
// Chosen limits (documented here, the single source of truth for both):
//   - MAX_SOURCE_FILE_SIZE_BYTES: 20 MB — a hard ceiling on the ORIGINAL
//     file the admin selects, checked before attempting to decode it at
//     all. Protects the browser tab from hanging/crashing trying to decode
//     an absurdly large file; a real phone photo is normally 2-8 MB, so
//     this leaves generous headroom without being unbounded.
//   - TARGET_LONG_EDGE_PX: 1900 — the optimized image's longer side, chosen
//     from the requested ~1800-2000px range. Large enough for a crisp
//     product-detail hero image, far smaller than a raw phone photo
//     (typically 3000-4000px+), which is where most of the size reduction
//     comes from. Never upscales a smaller original.
//   - JPEG/WebP quality 0.82 — a standard "sensible ecommerce quality"
//     compromise: visually clean at product-photo scale, well below the
//     point of diminishing returns on file size.
// PNG is re-encoded as PNG (lossless) rather than converted to JPEG/WebP —
// canvas re-encoding still shrinks it a lot via the dimension reduction
// alone, and this is the only way to guarantee a PNG's transparency (if it
// has any) is never destroyed, per the explicit requirement not to do that.

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_SOURCE_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const TARGET_LONG_EDGE_PX = 1900;
const JPEG_QUALITY = 0.82;
const WEBP_QUALITY = 0.82;

// Client-side pre-check — a UX convenience so a bad selection is rejected
// immediately with a friendly Spanish message, before spending any time
// optimizing/uploading. The server (prepareProductImageUpload) re-validates
// independently and is the actual boundary; never trust this alone.
export function validateSelectedImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    return "Formato no permitido. Usá JPG, PNG o WebP.";
  }
  if (file.size > MAX_SOURCE_FILE_SIZE_BYTES) {
    return `La imagen es demasiado pesada (máximo ${MAX_SOURCE_FILE_SIZE_BYTES / (1024 * 1024)} MB).`;
  }
  return null;
}

export interface OptimizedImage {
  file: File;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
}

function outputContentTypeFor(sourceType: string): string {
  if (sourceType === "image/png") return "image/png";
  if (sourceType === "image/webp") return "image/webp";
  return "image/jpeg";
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function renamedFilename(originalName: string, extension: string): string {
  const base = originalName.replace(/\.[^./\\]+$/, "");
  return `${base || "imagen"}.${extension}`;
}

// Resizes (never upscales) to at most TARGET_LONG_EDGE_PX on the long edge
// and re-encodes at a fixed quality — see the module doc comment for the
// exact numbers and why. Throws a friendly Spanish Error if the browser
// can't decode/process the file (corrupt image, unsupported variant, etc.)
// — callers should show that message directly, never a raw
// DOMException/browser error.
export async function optimizeImageForUpload(file: File): Promise<OptimizedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("No pudimos leer esta imagen. Probá con otro archivo.");
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > TARGET_LONG_EDGE_PX ? TARGET_LONG_EDGE_PX / longEdge : 1;
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador no puede procesar imágenes.");
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const outputType = outputContentTypeFor(file.type);
    const quality = outputType === "image/png" ? undefined : outputType === "image/webp" ? WEBP_QUALITY : JPEG_QUALITY;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("No se pudo optimizar la imagen."))),
        outputType,
        quality,
      );
    });

    const extension = extensionFor(outputType);
    const optimizedFile = new File([blob], renamedFilename(file.name, extension), { type: outputType });

    return {
      file: optimizedFile,
      width: targetWidth,
      height: targetHeight,
      originalSize: file.size,
      optimizedSize: optimizedFile.size,
    };
  } finally {
    bitmap.close();
  }
}
