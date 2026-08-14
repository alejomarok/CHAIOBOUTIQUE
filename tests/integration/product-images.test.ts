// @vitest-environment node
import "./guard";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { setStorageProviderForTesting } from "@/modules/storage";
import { StorageValidationError } from "@/modules/storage/validation";
import { InMemoryStorageProvider } from "../fixtures/in-memory-storage-provider";
import { uploadTestImage } from "../fixtures/upload-test-image";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import {
  deleteProductImage,
  finalizeProductImageUpload,
  InvalidImagePathError,
  prepareProductImageUpload,
  setPrimaryImage,
  TooManyImagesError,
} from "@/modules/products/product-images";
import { createProduct } from "@/modules/products/service";

// A minimal valid 1x1 PNG, so validateImageFileSignature + image-size both
// accept it as a genuine image, not just a MIME-type claim.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("product images — storage abstraction (real DB, fake storage)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];
  const fakeStorage = new InMemoryStorageProvider();

  beforeAll(() => {
    setStorageProviderForTesting(fakeStorage);
  });

  afterAll(() => {
    setStorageProviderForTesting(null);
  });

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function setup() {
    const actor = await createTestUser({
      name: "Image Actor",
      email: `image-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Image Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    const product = await createProduct(
      { name: `Image Producto ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    return { actor, product };
  }

  it("uploads an image, persists metadata, and the first image becomes primary", async () => {
    const { actor, product } = await setup();

    const image = await uploadTestImage(
      fakeStorage,
      {
        productId: product.id,
        file: ONE_PIXEL_PNG,
        filename: "swatch.png",
        contentType: "image/png",
      },
      actor.id,
    );
    cleanup.push(() => prisma.productImage.deleteMany({ where: { id: image.id } }));

    expect(image.isPrimary).toBe(true);
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(fakeStorage.has(image.bucket, image.path)).toBe(true);
  });

  it("rejects a declared content type that doesn't match the actual bytes", async () => {
    const { actor, product } = await setup();

    await expect(
      uploadTestImage(
        fakeStorage,
        {
          productId: product.id,
          file: ONE_PIXEL_PNG,
          filename: "fake.jpg",
          contentType: "image/jpeg",
        },
        actor.id,
      ),
    ).rejects.toThrow();
  });

  it("deleting an image removes both the DB row and the storage object", async () => {
    const { actor, product } = await setup();

    const image = await uploadTestImage(
      fakeStorage,
      { productId: product.id, file: ONE_PIXEL_PNG, filename: "a.png", contentType: "image/png" },
      actor.id,
    );

    await deleteProductImage(image.id, actor.id);

    const row = await prisma.productImage.findUnique({ where: { id: image.id } });
    expect(row).toBeNull();
    expect(fakeStorage.has(image.bucket, image.path)).toBe(false);
  });

  it("setPrimaryImage ensures exactly one primary image", async () => {
    const { actor, product } = await setup();

    const first = await uploadTestImage(
      fakeStorage,
      { productId: product.id, file: ONE_PIXEL_PNG, filename: "a.png", contentType: "image/png" },
      actor.id,
    );
    const second = await uploadTestImage(
      fakeStorage,
      { productId: product.id, file: ONE_PIXEL_PNG, filename: "b.png", contentType: "image/png" },
      actor.id,
    );
    cleanup.push(() =>
      prisma.productImage.deleteMany({ where: { id: { in: [first.id, second.id] } } }),
    );

    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);

    await setPrimaryImage(second.id, actor.id);

    const [refreshedFirst, refreshedSecond] = await Promise.all([
      prisma.productImage.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.productImage.findUniqueOrThrow({ where: { id: second.id } }),
    ]);
    expect(refreshedFirst.isPrimary).toBe(false);
    expect(refreshedSecond.isPrimary).toBe(true);

    const primaryCount = await prisma.productImage.count({
      where: { productId: product.id, isPrimary: true },
    });
    expect(primaryCount).toBe(1);
  });

  it("rejects an upload past the per-product image cap", async () => {
    const { actor, product } = await setup();

    for (let i = 0; i < 10; i++) {
      const image = await uploadTestImage(
        fakeStorage,
        {
          productId: product.id,
          file: ONE_PIXEL_PNG,
          filename: `img-${i}.png`,
          contentType: "image/png",
        },
        actor.id,
      );
      cleanup.push(() => prisma.productImage.deleteMany({ where: { id: image.id } }));
    }

    await expect(
      uploadTestImage(
        fakeStorage,
        {
          productId: product.id,
          file: ONE_PIXEL_PNG,
          filename: "one-too-many.png",
          contentType: "image/png",
        },
        actor.id,
      ),
    ).rejects.toThrow(TooManyImagesError);
  });

  it("prepareProductImageUpload returns a server-generated, product-scoped path and signed target", async () => {
    const { product } = await setup();

    const prepared = await prepareProductImageUpload({
      productId: product.id,
      filename: "phone-photo.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
    });

    expect(prepared.bucket).toBe(env.SUPABASE_PRODUCT_IMAGES_BUCKET);
    expect(prepared.signedUrl).toBeTruthy();
    expect(prepared.token).toBeTruthy();
    // Exactly products/{productId}/{uuid}.jpg — never the caller-supplied
    // filename, never a path the caller could influence.
    expect(prepared.path).toMatch(
      new RegExp(`^products/${product.id}/[0-9a-f-]{36}\\.jpg$`),
    );
  });

  it("prepareProductImageUpload rejects a disallowed MIME type", async () => {
    const { product } = await setup();

    await expect(
      prepareProductImageUpload({
        productId: product.id,
        filename: "doc.pdf",
        contentType: "application/pdf",
        fileSize: 1024,
      }),
    ).rejects.toThrow(StorageValidationError);
  });

  it("prepareProductImageUpload rejects a file over the upload size limit", async () => {
    const { product } = await setup();

    await expect(
      prepareProductImageUpload({
        productId: product.id,
        filename: "big.jpg",
        contentType: "image/jpeg",
        fileSize: 6 * 1024 * 1024,
      }),
    ).rejects.toThrow(StorageValidationError);
  });

  it("finalizeProductImageUpload rejects a path pointing at a different product's folder", async () => {
    const { actor, product } = await setup();
    const otherProduct = await createProduct({ name: `Other Producto ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.product.delete({ where: { id: otherProduct.id } }));

    const preparedForOther = await prepareProductImageUpload({
      productId: otherProduct.id,
      filename: "a.png",
      contentType: "image/png",
      fileSize: ONE_PIXEL_PNG.byteLength,
    });
    await fakeStorage.upload({
      bucket: preparedForOther.bucket,
      path: preparedForOther.path,
      file: ONE_PIXEL_PNG,
      contentType: "image/png",
    });

    // Claims to be finalizing an upload for `product`, but the echoed-back
    // path actually belongs to `otherProduct` — must never be trusted.
    await expect(
      finalizeProductImageUpload(
        {
          productId: product.id,
          bucket: preparedForOther.bucket,
          path: preparedForOther.path,
          contentType: "image/png",
        },
        actor.id,
      ),
    ).rejects.toThrow(InvalidImagePathError);

    expect(fakeStorage.has(preparedForOther.bucket, preparedForOther.path)).toBe(true);
  });

  it("finalizeProductImageUpload rejects a hand-crafted, non-UUID path", async () => {
    const { actor, product } = await setup();
    const craftedPath = `products/${product.id}/not-a-uuid.png`;
    const bucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
    await fakeStorage.upload({ bucket, path: craftedPath, file: ONE_PIXEL_PNG, contentType: "image/png" });

    await expect(
      finalizeProductImageUpload(
        { productId: product.id, bucket, path: craftedPath, contentType: "image/png" },
        actor.id,
      ),
    ).rejects.toThrow(InvalidImagePathError);
  });

  it("cleans up the storage object if ProductImage creation fails", async () => {
    const { actor, product } = await setup();

    const prepared = await prepareProductImageUpload({
      productId: product.id,
      filename: "a.png",
      contentType: "image/png",
      fileSize: ONE_PIXEL_PNG.byteLength,
    });
    await fakeStorage.upload({
      bucket: prepared.bucket,
      path: prepared.path,
      file: ONE_PIXEL_PNG,
      contentType: "image/png",
    });

    const createSpy = vi
      .spyOn(prisma.productImage, "create")
      .mockRejectedValueOnce(new Error("simulated DB failure"));

    try {
      await expect(
        finalizeProductImageUpload(
          {
            productId: product.id,
            bucket: prepared.bucket,
            path: prepared.path,
            contentType: "image/png",
          },
          actor.id,
        ),
      ).rejects.toThrow("simulated DB failure");
    } finally {
      createSpy.mockRestore();
    }

    // Storage upload had succeeded, DB creation failed — the object must
    // not be left orphaned.
    expect(fakeStorage.has(prepared.bucket, prepared.path)).toBe(false);
  });
});
