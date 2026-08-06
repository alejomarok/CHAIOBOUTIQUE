import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createColor, createSizeGroup, createSizeOption } from "@/modules/attributes/service-core";
import { createCategory } from "@/modules/categories/service-core";
import { adjustInventory } from "@/modules/inventory/service-core";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service-core";
import { createWarehouse, setDefaultWarehouse } from "@/modules/warehouses/service-core";

import { CUSTOMER_FIXTURE } from "./fixture-credentials";

// Full guest→customer cart journey over real HTTP against the isolated
// Docker test database, the fixed e2e port, and the in-memory e2e storage
// provider (see the E2E infrastructure stabilization checkpoint) — proves
// the anonymous cart cookie, the cart page, and the merge-on-sign-in flow
// all genuinely work together, not just each in isolation.
test.describe("cart (real DB, real HTTP)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanup);
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  test("guest adds to cart, it persists across refresh, merges on sign-in, and can be emptied", async ({
    page,
  }) => {
    const actor = await createTestUser({
      name: "Cart E2E Actor",
      email: `cart-e2e-actor-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Cart E2E Categoria ${Date.now()}` }, actor.id);

    const sizeGroup = await createSizeGroup(
      { code: `CART-E2E-SG-${Date.now()}`, name: `Talles Cart E2E ${Date.now()}` },
      actor.id,
    );
    const sizeOption = await createSizeOption(
      { sizeGroupId: sizeGroup.id, code: "M", label: "M", sortOrder: 1 },
      actor.id,
    );
    const color = await createColor(
      { key: `cart-e2e-rojo-${Date.now()}`, displayName: "Rojo" },
      actor.id,
    );

    const uniqueName = `Remera Cart E2E ${Date.now()}`;
    const product = await createProduct(
      {
        name: uniqueName,
        categoryId: category.id,
        sizeGroupId: sizeGroup.id,
        defaultPriceAmount: 1500000n,
      },
      actor.id,
    );

    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: sizeOption.id, colorId: color.id, sku: `CART-E2E-SKU-${Date.now()}` }],
      actor.id,
    );

    const existingDefault = await prisma.warehouse.findFirst({ where: { isDefault: true } });
    let warehouseId = existingDefault?.id;
    if (!warehouseId) {
      const created = await createWarehouse(
        { code: `CART-E2E-WH-${Date.now()}`, name: "Depósito Cart E2E" },
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

    // The shared CUSTOMER_FIXTURE account is reused across the whole e2e
    // suite (see tests/e2e/global-setup.ts) — clear out anything it might
    // already be carrying so this test's cart assertions are unambiguous,
    // and clean up again afterwards for whichever spec runs next.
    const customerUser = await prisma.user.findUniqueOrThrow({
      where: { email: CUSTOMER_FIXTURE.email },
    });
    await prisma.cart.deleteMany({ where: { userId: customerUser.id } });
    cleanup.push(() => prisma.cart.deleteMany({ where: { userId: customerUser.id } }));

    // 1. Open the public catalog as a guest.
    await page.goto(`/catalog?q=${encodeURIComponent(uniqueName)}`);
    await expect(page.getByText(uniqueName)).toBeVisible();

    // 2. Open the product.
    await page.getByText(uniqueName).click();
    await expect(page).toHaveURL(new RegExp(`/product/${product.slug}$`));

    // 3. Select an available size/color combination.
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: "Rojo" }).click();

    // 4. Add it to the cart.
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByText("Se agregó al carrito.")).toBeVisible();

    // 5. Confirm the header badge updates.
    await expect(page.getByRole("link", { name: "Carrito, 1 artículos" })).toBeVisible();

    // 6. Open the cart and modify the quantity.
    await page.goto("/cart");
    await expect(page.getByText(uniqueName)).toBeVisible();
    await page.getByRole("button", { name: "Sumar cantidad" }).click();
    await expect(page.getByRole("link", { name: "Carrito, 2 artículos" })).toBeVisible();

    // 7. Refresh and confirm the cart persists (a real HttpOnly cookie, not
    // just client-side state).
    await page.reload();
    await expect(page.getByText(uniqueName)).toBeVisible();
    await expect(page.getByRole("link", { name: "Carrito, 2 artículos" })).toBeVisible();

    // 8. Sign in as a verified CUSTOMER.
    await page.goto("/login");
    await page.getByLabel("Email").fill(CUSTOMER_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(CUSTOMER_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/catalog/);

    // 9. Confirm the anonymous cart was merged and is still visible on the
    // customer's account.
    await page.goto("/cart");
    await expect(page.getByText(uniqueName)).toBeVisible();
    await expect(page.getByRole("link", { name: "Carrito, 2 artículos" })).toBeVisible();

    // 10. Remove the item and confirm the empty state.
    await page.getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByText("Tu carrito está vacío")).toBeVisible();
    await expect(page.getByRole("link", { name: "Carrito" })).toBeVisible();
  });
});
