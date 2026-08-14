import { finalizeProductImageUpload, prepareProductImageUpload } from "@/modules/products/product-images";
import type { InMemoryStorageProvider } from "./in-memory-storage-provider";

// Integration tests have no real browser to PUT to a signed URL, so this
// drives the exact same two-phase flow ProductImagesManager drives in the
// browser (prepare -> upload -> finalize), just substituting the browser's
// fetch/XHR PUT with a direct call to the injected fake storage provider's
// own upload(). Exercises the real prepare/finalize authorization and
// validation logic end-to-end, not a shortcut around it.
export async function uploadTestImage(
  fakeStorage: InMemoryStorageProvider,
  input: { productId: string; file: Buffer; filename: string; contentType: string; altText?: string | null },
  actorId: string,
) {
  const prepared = await prepareProductImageUpload({
    productId: input.productId,
    filename: input.filename,
    contentType: input.contentType,
    fileSize: input.file.byteLength,
  });

  await fakeStorage.upload({
    bucket: prepared.bucket,
    path: prepared.path,
    file: input.file,
    contentType: input.contentType,
  });

  return finalizeProductImageUpload(
    {
      productId: input.productId,
      bucket: prepared.bucket,
      path: prepared.path,
      contentType: input.contentType,
      altText: input.altText ?? null,
    },
    actorId,
  );
}
