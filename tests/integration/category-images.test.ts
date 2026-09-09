// @vitest-environment node
import "./guard";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { setStorageProviderForTesting } from "@/modules/storage";
import { StorageValidationError } from "@/modules/storage/validation";
import { InMemoryStorageProvider } from "../fixtures/in-memory-storage-provider";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import {
  CategoryNotFoundForImageError,
  deleteCategoryImage,
  finalizeCategoryImageUpload,
  InvalidCategoryImagePathError,
  prepareCategoryImageUpload,
} from "@/modules/categories/category-images";
import { createCategory } from "@/modules/categories/service";

// Same minimal valid 1x1 PNG as product-images.test.ts, so
// validateImageFileSignature + image-size both accept it as a genuine image.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("category images — storage abstraction (real DB, fake storage)", () => {
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
      name: "Category Image Actor",
      email: `category-image-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Imagen Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    return { actor, category };
  }

  // Drives the same two-phase flow CategoryImageManager drives in the
  // browser (prepare -> upload -> finalize), substituting the browser's
  // fetch/XHR PUT with a direct call to the injected fake storage
  // provider's own upload().
  async function uploadCategoryImage(
    input: { categoryId: string; file: Buffer; filename: string; contentType: string; altText?: string | null },
    actorId: string,
  ) {
    const prepared = await prepareCategoryImageUpload({
      categoryId: input.categoryId,
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

    return finalizeCategoryImageUpload(
      {
        categoryId: input.categoryId,
        bucket: prepared.bucket,
        path: prepared.path,
        contentType: input.contentType,
        altText: input.altText ?? null,
      },
      actorId,
    );
  }

  it("uploads an image and persists bucket/path/altText on the Category row", async () => {
    const { actor, category } = await setup();

    const updated = await uploadCategoryImage(
      { categoryId: category.id, file: ONE_PIXEL_PNG, filename: "hero.png", contentType: "image/png", altText: "Portada" },
      actor.id,
    );

    expect(updated.imageBucket).toBe(env.SUPABASE_PRODUCT_IMAGES_BUCKET);
    expect(updated.imagePath).toMatch(new RegExp(`^categories/${category.id}/[0-9a-f-]{36}\\.png$`));
    expect(updated.imageAltText).toBe("Portada");
    expect(fakeStorage.has(updated.imageBucket!, updated.imagePath!)).toBe(true);
  });

  it("rejects a declared content type that doesn't match the actual bytes", async () => {
    const { actor, category } = await setup();

    await expect(
      uploadCategoryImage(
        { categoryId: category.id, file: ONE_PIXEL_PNG, filename: "fake.jpg", contentType: "image/jpeg" },
        actor.id,
      ),
    ).rejects.toThrow();

    const row = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(row.imageBucket).toBeNull();
  });

  it("replacing an image updates the DB to the new object and deletes the OLD object", async () => {
    const { actor, category } = await setup();

    const first = await uploadCategoryImage(
      { categoryId: category.id, file: ONE_PIXEL_PNG, filename: "a.png", contentType: "image/png" },
      actor.id,
    );
    const firstBucket = first.imageBucket!;
    const firstPath = first.imagePath!;
    expect(fakeStorage.has(firstBucket, firstPath)).toBe(true);

    const second = await uploadCategoryImage(
      { categoryId: category.id, file: ONE_PIXEL_PNG, filename: "b.png", contentType: "image/png" },
      actor.id,
    );

    expect(second.imagePath).not.toBe(firstPath);
    expect(fakeStorage.has(second.imageBucket!, second.imagePath!)).toBe(true);
    // The OLD object must be gone — never two live objects for one category.
    expect(fakeStorage.has(firstBucket, firstPath)).toBe(false);

    const row = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(row.imagePath).toBe(second.imagePath);
  });

  it("deleteCategoryImage clears the DB reference first, then deletes the storage object — never leaves the DB pointing at a deleted object", async () => {
    const { actor, category } = await setup();
    const uploaded = await uploadCategoryImage(
      { categoryId: category.id, file: ONE_PIXEL_PNG, filename: "a.png", contentType: "image/png" },
      actor.id,
    );

    await deleteCategoryImage(category.id, actor.id);

    const row = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(row.imageBucket).toBeNull();
    expect(row.imagePath).toBeNull();
    expect(row.imageAltText).toBeNull();
    expect(fakeStorage.has(uploaded.imageBucket!, uploaded.imagePath!)).toBe(false);
  });

  it("deleteCategoryImage on a category with no image is a safe no-op", async () => {
    const { actor, category } = await setup();
    await expect(deleteCategoryImage(category.id, actor.id)).resolves.toBeUndefined();
  });

  it("prepareCategoryImageUpload returns a server-generated, category-scoped path and never accepts a caller-chosen path", async () => {
    const { category } = await setup();

    const prepared = await prepareCategoryImageUpload({
      categoryId: category.id,
      filename: "phone-photo.jpg",
      contentType: "image/jpeg",
      fileSize: 1024,
    });

    expect(prepared.bucket).toBe(env.SUPABASE_PRODUCT_IMAGES_BUCKET);
    expect(prepared.path).toMatch(new RegExp(`^categories/${category.id}/[0-9a-f-]{36}\\.jpg$`));
  });

  it("prepareCategoryImageUpload rejects a disallowed MIME type", async () => {
    const { category } = await setup();

    await expect(
      prepareCategoryImageUpload({
        categoryId: category.id,
        filename: "doc.pdf",
        contentType: "application/pdf",
        fileSize: 1024,
      }),
    ).rejects.toThrow(StorageValidationError);
  });

  it("prepareCategoryImageUpload rejects a file over the upload size limit", async () => {
    const { category } = await setup();

    await expect(
      prepareCategoryImageUpload({
        categoryId: category.id,
        filename: "big.jpg",
        contentType: "image/jpeg",
        fileSize: 6 * 1024 * 1024,
      }),
    ).rejects.toThrow(StorageValidationError);
  });

  it("prepareCategoryImageUpload rejects a nonexistent category", async () => {
    await expect(
      prepareCategoryImageUpload({
        categoryId: "does-not-exist",
        filename: "a.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    ).rejects.toThrow(CategoryNotFoundForImageError);
  });

  // Manual acceptance item 20: arbitrary storage paths are rejected — a
  // client can never choose where its upload lands, even by echoing back a
  // real object that genuinely exists in storage under a different
  // category's folder or a hand-crafted shape.
  it("finalizeCategoryImageUpload rejects a path pointing at a different category's folder", async () => {
    const { actor, category } = await setup();
    const otherCategory = await createCategory({ name: `Other Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: otherCategory.id } }));

    const preparedForOther = await prepareCategoryImageUpload({
      categoryId: otherCategory.id,
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

    await expect(
      finalizeCategoryImageUpload(
        { categoryId: category.id, bucket: preparedForOther.bucket, path: preparedForOther.path, contentType: "image/png" },
        actor.id,
      ),
    ).rejects.toThrow(InvalidCategoryImagePathError);

    // The other category's real object must be untouched.
    expect(fakeStorage.has(preparedForOther.bucket, preparedForOther.path)).toBe(true);
  });

  it("finalizeCategoryImageUpload rejects a hand-crafted, non-UUID path", async () => {
    const { actor, category } = await setup();
    const craftedPath = `categories/${category.id}/not-a-uuid.png`;
    const bucket = env.SUPABASE_PRODUCT_IMAGES_BUCKET;
    await fakeStorage.upload({ bucket, path: craftedPath, file: ONE_PIXEL_PNG, contentType: "image/png" });

    await expect(
      finalizeCategoryImageUpload({ categoryId: category.id, bucket, path: craftedPath, contentType: "image/png" }, actor.id),
    ).rejects.toThrow(InvalidCategoryImagePathError);
  });

  it("cleans up the newly-uploaded orphan if the Category DB update fails", async () => {
    const { actor, category } = await setup();

    const prepared = await prepareCategoryImageUpload({
      categoryId: category.id,
      filename: "a.png",
      contentType: "image/png",
      fileSize: ONE_PIXEL_PNG.byteLength,
    });
    await fakeStorage.upload({ bucket: prepared.bucket, path: prepared.path, file: ONE_PIXEL_PNG, contentType: "image/png" });

    const updateSpy = vi.spyOn(prisma.category, "update").mockRejectedValueOnce(new Error("simulated DB failure"));

    try {
      await expect(
        finalizeCategoryImageUpload(
          { categoryId: category.id, bucket: prepared.bucket, path: prepared.path, contentType: "image/png" },
          actor.id,
        ),
      ).rejects.toThrow("simulated DB failure");
    } finally {
      updateSpy.mockRestore();
    }

    expect(fakeStorage.has(prepared.bucket, prepared.path)).toBe(false);
  });
});
