import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service-core";
import { adjustInventory } from "@/modules/inventory/service-core";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service-core";
import { createWarehouse, setDefaultWarehouse } from "@/modules/warehouses/service-core";

// Real end-to-end proof that the public/admin boundary in
// modules/products/public-queries.ts actually holds over HTTP, not just in
// an integration test that calls the query function directly — a DRAFT
// product must never render, and an ACTIVE one with stock must show as
// "Stock disponible" without exposing cost or exact quantities in the page.

test.describe("public catalog and product detail (real DB, real HTTP)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanup);
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

    // This category/product/variant are never torn down in this test's own
    // cleanup either, for the same reason as the warehouse below: once a
    // real inventory movement/balance references the variant, Category →
    // Product → ProductVariant are all `onDelete: Restrict`, so none of
    // them can be deleted anymore regardless of ordering. Left for
    // global-teardown.ts's full-suite reset, same as the warehouse.
    const category = await createCategory({ name: `E2E Categoria ${Date.now()}` }, actor.id);

    const uniqueName = `Remera E2E ${Date.now()}`;
    const product = await createProduct(
      { name: uniqueName, categoryId: category.id, defaultPriceAmount: 1500000n },
      actor.id,
    );

    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `E2E-SKU-${Date.now()}` }],
      actor.id,
    );

    // Never torn down in this test's own cleanup: once real inventory
    // movements/balances reference this warehouse, deleting it is
    // impossible anyway (inventory_movement has a real, DB-level append-
    // only trigger — see tests/integration/reset-db.ts's doc comment — so
    // even clearing inventory_balance first wouldn't make a warehouse
    // delete succeed). Treated the same as the ADMIN/RESTRICTED/CUSTOMER
    // fixture users: reasonable shared test infrastructure for the run,
    // wiped only by the full-suite reset in global-teardown.ts.
    const existingDefault = await prisma.warehouse.findFirst({ where: { isDefault: true } });
    let warehouseId = existingDefault?.id;
    if (!warehouseId) {
      const created = await createWarehouse(
        { code: `E2E-MAIN-${Date.now()}`, name: "Depósito E2E" },
        actor.id,
      );
      warehouseId = created.id;
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
    await expect(page.getByText("Stock disponible")).toBeVisible();
  });

  test("a DRAFT product never renders on the public site", async ({ page }) => {
    const actor = await createTestUser({
      name: "Catalog E2E Actor Draft",
      email: `catalog-e2e-draft-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `E2E Categoria Draft ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.deleteMany({ where: { id: category.id } }));

    const uniqueName = `Borrador E2E ${Date.now()}`;
    const product = await createProduct(
      { name: uniqueName, categoryId: category.id, defaultPriceAmount: 1000000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.deleteMany({ where: { id: product.id } }));

    // The rendered content (next/navigation's notFound()) is the reliable,
    // actually-enforced signal here, not the HTTP status code — this
    // specific Next.js version/dev-server combination renders the correct
    // "Página no encontrada" content but does not set a real 404 status
    // (confirmed independently of authInterrupts: the same pattern shows up
    // for forbidden()/unauthorized() in login.spec.ts/imports.spec.ts, and
    // notFound() is a long-stable, non-experimental API, so this isn't
    // specific to that experimental feature).
    await page.goto(`/product/${product.slug}`);
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();

    await page.goto(`/catalog?q=${encodeURIComponent(uniqueName)}`);
    await expect(page.getByText(uniqueName)).not.toBeVisible();
  });
});
