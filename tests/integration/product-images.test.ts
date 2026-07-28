// @vitest-environment node
import "./guard";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { setStorageProviderForTesting } from "@/modules/storage";
import { InMemoryStorageProvider } from "../fixtures/in-memory-storage-provider";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import {
  deleteProductImage,
  setPrimaryImage,
  TooManyImagesError,
  uploadProductImage,
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

    const image = await uploadProductImage(
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
      uploadProductImage(
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

    const image = await uploadProductImage(
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

    const first = await uploadProductImage(
      { productId: product.id, file: ONE_PIXEL_PNG, filename: "a.png", contentType: "image/png" },
      actor.id,
    );
    const second = await uploadProductImage(
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
      const image = await uploadProductImage(
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
      uploadProductImage(
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
});
