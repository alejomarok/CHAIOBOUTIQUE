// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createColor, createSizeGroup, createSizeOption } from "@/modules/attributes/service";
import {
  createProduct,
  createVariants,
  DuplicateVariantCombinationError,
  ProductNotReadyForPublicationError,
  SizeOptionGroupMismatchError,
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

    const sizeGroup = await createSizeGroup(
      { code: `TOPS-${Date.now()}-${Math.random()}`, name: "Remeras" },
      actor.id,
    );
    cleanup.push(() => prisma.sizeGroup.delete({ where: { id: sizeGroup.id } }));

    const sizeS = await createSizeOption(
      { sizeGroupId: sizeGroup.id, code: "S", label: "S" },
      actor.id,
    );
    const sizeM = await createSizeOption(
      { sizeGroupId: sizeGroup.id, code: "M", label: "M" },
      actor.id,
    );
    cleanup.push(() =>
      prisma.sizeOption.deleteMany({ where: { id: { in: [sizeS.id, sizeM.id] } } }),
    );

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

    return { actor, category, sizeGroup, sizeS, sizeM, colorBlack, colorWhite };
  }

  it("creates a product with a full 2x2 variant matrix, no duplicates", async () => {
    const { actor, category, sizeGroup, sizeS, sizeM, colorBlack, colorWhite } = await setup();

    const product = await createProduct(
      {
        name: `Remera ${Date.now()}`,
        categoryId: category.id,
        sizeGroupId: sizeGroup.id,
        defaultPriceAmount: 1000000n,
      },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const combinations = [
      { sizeOptionId: sizeS.id, colorId: colorBlack.id },
      { sizeOptionId: sizeS.id, colorId: colorWhite.id },
      { sizeOptionId: sizeM.id, colorId: colorBlack.id },
      { sizeOptionId: sizeM.id, colorId: colorWhite.id },
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
    const { actor, category, sizeGroup, sizeS, colorBlack } = await setup();

    const product = await createProduct(
      { name: `Producto ${Date.now()}`, categoryId: category.id, sizeGroupId: sizeGroup.id },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const first = await createVariants(
      product.id,
      [{ sizeOptionId: sizeS.id, colorId: colorBlack.id, sku: `DUP-${Date.now()}-1` }],
      actor.id,
    );
    cleanup.push(() => prisma.productVariant.deleteMany({ where: { id: { in: [first[0].id] } } }));

    await expect(
      createVariants(
        product.id,
        [{ sizeOptionId: sizeS.id, colorId: colorBlack.id, sku: `DUP-${Date.now()}-2` }],
        actor.id,
      ),
    ).rejects.toThrow(DuplicateVariantCombinationError);
  });

  it("rejects a sizeOption that belongs to a different group than the product's", async () => {
    const { actor, category, colorBlack } = await setup();

    const otherGroup = await createSizeGroup(
      { code: `OTHER-${Date.now()}-${Math.random()}`, name: "Otro grupo" },
      actor.id,
    );
    cleanup.push(() => prisma.sizeGroup.delete({ where: { id: otherGroup.id } }));
    const otherSize = await createSizeOption(
      { sizeGroupId: otherGroup.id, code: "X", label: "X" },
      actor.id,
    );
    cleanup.push(() => prisma.sizeOption.delete({ where: { id: otherSize.id } }));

    const product = await createProduct(
      { name: `Producto cross-group ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    await expect(
      createVariants(
        product.id,
        [{ sizeOptionId: otherSize.id, colorId: colorBlack.id, sku: `XG-${Date.now()}` }],
        actor.id,
      ),
    ).rejects.toThrow(SizeOptionGroupMismatchError);
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
    const { actor, category, sizeGroup, sizeS, colorBlack } = await setup();

    const product = await createProduct(
      {
        name: `Publicable ${Date.now()}`,
        categoryId: category.id,
        sizeGroupId: sizeGroup.id,
        defaultPriceAmount: 500000n,
      },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: sizeS.id, colorId: colorBlack.id, sku: `PUB-${Date.now()}` }],
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
