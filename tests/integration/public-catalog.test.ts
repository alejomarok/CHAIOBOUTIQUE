// @vitest-environment node
import "./guard";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { setStorageProviderForTesting } from "@/modules/storage";
import { InMemoryStorageProvider } from "../fixtures/in-memory-storage-provider";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { getPublicProductBySlug, listPublicProducts } from "@/modules/products/public-queries";
import {
  deleteProductImage,
  setPrimaryImage,
  uploadProductImage,
} from "@/modules/products/product-images";
import {
  createProduct,
  createVariants,
  setProductStatus,
  toProductDTO,
} from "@/modules/products/service";

// A minimal valid 1x1 PNG, so validateImageFileSignature + image-size both
// accept it as a genuine image, not just a MIME-type claim.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("public catalog — never exposes internal fields (real DB)", () => {
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
      name: "Public Catalog Actor",
      email: `public-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Public Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    return { actor, category };
  }

  it("never returns a DRAFT product from listPublicProducts", async () => {
    const { actor, category } = await setup();

    const draft = await createProduct(
      { name: `Borrador ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: draft.id } }));

    const results = await listPublicProducts({ search: draft.name });
    expect(results.find((p) => p.id === draft.id)).toBeUndefined();
  });

  it("never returns an ACTIVE product by slug once it's ARCHIVED", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      { name: `Publicado ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `PUB-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );

    await setProductStatus(product.id, "ACTIVE", actor.id);
    expect(await getPublicProductBySlug(product.slug)).not.toBeNull();

    await setProductStatus(product.id, "ARCHIVED", actor.id);
    expect(await getPublicProductBySlug(product.slug)).toBeNull();
  });

  it("public product detail never includes cost, legacy ids, or exact stock counts", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      {
        name: `Con Costo ${Date.now()}`,
        categoryId: category.id,
        defaultPriceAmount: 5000n,
        referenceCostAmount: 2000n,
      },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `COST-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );
    await setProductStatus(product.id, "ACTIVE", actor.id);

    const detail = await getPublicProductBySlug(product.slug);
    expect(detail).not.toBeNull();
    // The DTO shape itself has no cost/legacy fields — not just "happens to
    // be undefined" but structurally absent.
    expect(detail).not.toHaveProperty("referenceCostAmount");
    expect(detail).not.toHaveProperty("legacySource");
    expect(detail).not.toHaveProperty("legacyId");
    expect(detail?.variants[0]).not.toHaveProperty("costAmount");
    // Stock is a derived status, never a raw number.
    expect(detail?.variants[0].stockStatus).toBe("OUT_OF_STOCK");
    expect(Object.keys(detail?.variants[0] ?? {})).not.toContain("quantity");
  });

  it("toProductDTO redacts cost unless includeCost is true", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      { name: `DTO Test ${Date.now()}`, categoryId: category.id, referenceCostAmount: 999n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const withoutCost = toProductDTO(product, { includeCost: false });
    const withCost = toProductDTO(product, { includeCost: true });

    expect(withoutCost.referenceCostAmount).toBeUndefined();
    expect(withCost.referenceCostAmount).toBe("999");
  });

  it("an active, fully publishable product appears in both listPublicProducts and getPublicProductBySlug", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      { name: `Publicable ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `VIS-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );
    await setProductStatus(product.id, "ACTIVE", actor.id);

    const listed = await listPublicProducts({ search: product.name });
    expect(listed.find((p) => p.id === product.id)).toBeDefined();
    expect(await getPublicProductBySlug(product.slug)).not.toBeNull();
  });

  it("an INACTIVE product does not appear in listPublicProducts or getPublicProductBySlug", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      { name: `Inactivo ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `INACT-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );
    await setProductStatus(product.id, "ACTIVE", actor.id);
    await setProductStatus(product.id, "INACTIVE", actor.id);

    const listed = await listPublicProducts({ search: product.name });
    expect(listed.find((p) => p.id === product.id)).toBeUndefined();
    expect(await getPublicProductBySlug(product.slug)).toBeNull();
  });

  it("a product without images still appears (primaryImageUrl null) when otherwise publishable", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      { name: `Sin Imagen ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `NOIMG-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );
    await setProductStatus(product.id, "ACTIVE", actor.id);

    const listed = await listPublicProducts({ search: product.name });
    const card = listed.find((p) => p.id === product.id);
    expect(card).toBeDefined();
    expect(card?.primaryImageUrl).toBeNull();

    const detail = await getPublicProductBySlug(product.slug);
    expect(detail?.images).toEqual([]);
  });

  it("the primary image is what's returned by listPublicProducts and getPublicProductBySlug", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      { name: `Con Imagenes ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `IMG-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );

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
    await setPrimaryImage(second.id, actor.id);
    await setProductStatus(product.id, "ACTIVE", actor.id);

    const listed = await listPublicProducts({ search: product.name });
    const card = listed.find((p) => p.id === product.id);
    expect(card?.primaryImageUrl).toBe(fakeStorage.getPublicUrl(second.bucket, second.path));

    const detail = await getPublicProductBySlug(product.slug);
    const primaryInDetail = detail?.images.find((i) => i.isPrimary);
    expect(primaryInDetail?.url).toBe(fakeStorage.getPublicUrl(second.bucket, second.path));
  });

  it("deleting a product image never deletes the underlying product", async () => {
    const { actor, category } = await setup();

    const product = await createProduct(
      { name: `Elimina Imagen ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const image = await uploadProductImage(
      { productId: product.id, file: ONE_PIXEL_PNG, filename: "a.png", contentType: "image/png" },
      actor.id,
    );

    await deleteProductImage(image.id, actor.id);

    const stillExists = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stillExists).not.toBeNull();
  });
});
