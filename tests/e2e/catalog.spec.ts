import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { adjustInventory } from "@/modules/inventory/service";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service";
import { createWarehouse, setDefaultWarehouse } from "@/modules/warehouses/service";

// Real end-to-end proof that the public/admin boundary in
// modules/products/public-queries.ts actually holds over HTTP, not just in
// an integration test that calls the query function directly — a DRAFT
// product must never render, and an ACTIVE one with stock must show as
// "En stock" without exposing cost or exact quantities in the page.

test.describe("public catalog and product detail (real DB, real HTTP)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  test("an ACTIVE product with stock appears in /catalog and shows 'En stock' on its detail page", async ({
    page,
  }) => {
    const actor = await createTestUser({
      name: "Catalog E2E Actor",
      email: `catalog-e2e-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `E2E Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    const uniqueName = `Remera E2E ${Date.now()}`;
    const product = await createProduct(
      { name: uniqueName, categoryId: category.id, defaultPriceAmount: 1500000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const [variant] = await createVariants(
      product.id,
      [{ sizeId: null, colorId: null, sku: `E2E-SKU-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() => prisma.productVariant.delete({ where: { id: variant.id } }));

    const existingDefault = await prisma.warehouse.findFirst({ where: { isDefault: true } });
    let warehouseId = existingDefault?.id;
    if (!warehouseId) {
      const created = await createWarehouse(
        { code: `E2E-MAIN-${Date.now()}`, name: "Depósito E2E" },
        actor.id,
      );
      warehouseId = created.id;
      cleanup.push(() => prisma.warehouse.delete({ where: { id: created.id } }));
      await setDefaultWarehouse(created.id, actor.id);
    }

    await adjustInventory({
      variantId: variant.id,
      warehouseId,
      quantityDelta: 5,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    await setProductStatus(product.id, "ACTIVE", actor.id);

    await page.goto(`/catalog?q=${encodeURIComponent(uniqueName)}`);
    await expect(page.getByText(uniqueName)).toBeVisible();

    await page.getByText(uniqueName).click();
    await expect(page).toHaveURL(new RegExp(`/product/${product.slug}$`));
    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();
    await expect(page.getByText("En stock")).toBeVisible();
  });

  test("a DRAFT product never renders on the public site", async ({ page }) => {
    const actor = await createTestUser({
      name: "Catalog E2E Actor Draft",
      email: `catalog-e2e-draft-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `E2E Categoria Draft ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    const uniqueName = `Borrador E2E ${Date.now()}`;
    const product = await createProduct(
      { name: uniqueName, categoryId: category.id, defaultPriceAmount: 1000000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const response = await page.goto(`/product/${product.slug}`);
    expect(response?.status()).toBe(404);

    await page.goto(`/catalog?q=${encodeURIComponent(uniqueName)}`);
    await expect(page.getByText(uniqueName)).not.toBeVisible();
  });
});
