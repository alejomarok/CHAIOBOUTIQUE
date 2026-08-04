import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service-core";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service-core";

import { ADMIN_FIXTURE } from "./fixture-credentials";

// A minimal valid 1x1 PNG, so the real upload pipeline's file-signature
// check accepts it as a genuine image, not just a declared MIME type.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// Full admin round trip over real HTTP against TEST_DATABASE_URL: login →
// enter /admin → return to the storefront via the logo → open a real
// product → upload an image through the actual form → confirm the product
// (with its uploaded image) shows up on /catalog. Exercises the exact path
// flagged as under-tested in the usability stabilization pass.
test.describe("admin smoke flow (real DB, real HTTP)", () => {
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

  test("login as ADMIN, enter /admin, return to storefront via logo, open a product, upload an image, and see it in /catalog", async ({
    page,
  }) => {
    const actor = await createTestUser({
      name: "Admin Smoke Data Actor",
      email: `admin-smoke-data-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory(
      { name: `Admin Smoke Categoria ${Date.now()}` },
      actor.id,
    );
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    const uniqueName = `Producto Smoke ${Date.now()}`;
    const product = await createProduct(
      { name: uniqueName, categoryId: category.id, defaultPriceAmount: 990000n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `SMOKE-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() => prisma.productVariant.delete({ where: { id: variant.id } }));

    await setProductStatus(product.id, "ACTIVE", actor.id);

    // 1. Log in as ADMIN.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // 2. Enter /admin.
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();

    // 3. Return to the storefront through the logo.
    await page.getByRole("link", { name: "CHAIOBOUTIQUE" }).first().click();
    await expect(page).toHaveURL("/");

    // 4. Open the product in admin.
    await page.goto(`/admin/products/${product.id}`);
    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();
    await expect(page.getByText("Visible en la tienda")).toBeVisible();

    // 5. Upload an image through the real form.
    await page.locator('input[type="file"]').setInputFiles({
      name: "smoke.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Principal")).toBeVisible({ timeout: 15_000 });

    // 6. Confirm the product (with its image) appears in /catalog.
    await page.goto(`/catalog?q=${encodeURIComponent(uniqueName)}`);
    await expect(page.getByText(uniqueName)).toBeVisible();
    await expect(page.getByRole("img", { name: uniqueName })).toBeVisible();
  });
});
