// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createColor, createSize } from "@/modules/attributes/service";
import {
  createProduct,
  createVariants,
  DuplicateVariantCombinationError,
  ProductNotReadyForPublicationError,
  setProductStatus,
} from "@/modules/products/service";

describe("products — creation, variants, and publication rules (real DB)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

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
      name: "Product Actor",
      email: `product-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    const sizeS = await createSize({ key: `S-${Date.now()}`, displayName: "S" }, actor.id);
    const sizeM = await createSize({ key: `M-${Date.now()}`, displayName: "M" }, actor.id);
    cleanup.push(() => prisma.size.deleteMany({ where: { id: { in: [sizeS.id, sizeM.id] } } }));

    const colorBlack = await createColor(
      { key: `black-${Date.now()}`, displayName: "Negro" },
      actor.id,
    );
    const colorWhite = await createColor(
      { key: `white-${Date.now()}`, displayName: "Blanco" },
      actor.id,
    );
    cleanup.push(() =>
      prisma.color.deleteMany({ where: { id: { in: [colorBlack.id, colorWhite.id] } } }),
    );

    return { actor, category, sizeS, sizeM, colorBlack, colorWhite };
  }

  it("creates a product with a full 2x2 variant matrix, no duplicates", async () => {
    const { actor, category, sizeS, sizeM, colorBlack, colorWhite } = await setup();

    const product = await createProduct(
      { name: `Remera ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 1000000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const combinations = [
      { sizeId: sizeS.id, colorId: colorBlack.id },
      { sizeId: sizeS.id, colorId: colorWhite.id },
      { sizeId: sizeM.id, colorId: colorBlack.id },
      { sizeId: sizeM.id, colorId: colorWhite.id },
    ];
    const variants = await createVariants(
      product.id,
      combinations.map((combo, i) => ({ ...combo, sku: `TEST-${Date.now()}-${i}` })),
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );

    expect(variants).toHaveLength(4);

    const stored = await prisma.productVariant.findMany({ where: { productId: product.id } });
    expect(stored).toHaveLength(4);
  });

  it("rejects creating a duplicate (size, color) combination", async () => {
    const { actor, category, sizeS, colorBlack } = await setup();

    const product = await createProduct(
      { name: `Producto ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const first = await createVariants(
      product.id,
      [{ sizeId: sizeS.id, colorId: colorBlack.id, sku: `DUP-${Date.now()}-1` }],
      actor.id,
    );
    cleanup.push(() => prisma.productVariant.deleteMany({ where: { id: { in: [first[0].id] } } }));

    await expect(
      createVariants(
        product.id,
        [{ sizeId: sizeS.id, colorId: colorBlack.id, sku: `DUP-${Date.now()}-2` }],
        actor.id,
      ),
    ).rejects.toThrow(DuplicateVariantCombinationError);
  });

  it("cannot become ACTIVE without a category, an active variant, and a valid price", async () => {
    const actor = await createTestUser({
      name: "Publish Actor",
      email: `publish-actor-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const product = await createProduct({ name: `Sin Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    await expect(setProductStatus(product.id, "ACTIVE", actor.id)).rejects.toThrow(
      ProductNotReadyForPublicationError,
    );
  });

  it("becomes ACTIVE once category, an active priced variant exist", async () => {
    const { actor, category, sizeS, colorBlack } = await setup();

    const product = await createProduct(
      { name: `Publicable ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 500000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeId: sizeS.id, colorId: colorBlack.id, sku: `PUB-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );

    const activated = await setProductStatus(product.id, "ACTIVE", actor.id);
    expect(activated.status).toBe("ACTIVE");
  });

  it("archiving sets status and archivedAt", async () => {
    const { actor, category } = await setup();
    const product = await createProduct(
      { name: `Archivar ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const archived = await setProductStatus(product.id, "ARCHIVED", actor.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
  });
});
