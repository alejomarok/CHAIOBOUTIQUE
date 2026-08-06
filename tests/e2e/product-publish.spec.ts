import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service-core";
import { createProduct } from "@/modules/products/service-core";

import { ADMIN_FIXTURE } from "./fixture-credentials";

// Full admin round trip over real HTTP against TEST_DATABASE_URL, following
// the exact 8-step flow from the storefront/catalog usability checkpoint:
// login → confirm the role-aware dashboard button from the storefront →
// open an example product missing required data → review its visibility
// blockers → complete the required fields → publish it → "Ver en la
// tienda" → confirm it appears in /catalog.
test.describe("admin product publish flow (real DB, real HTTP)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanup);
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  test("login as ADMIN, see 'Ir al panel' from the storefront, complete an incomplete product, publish it, and confirm it appears in /catalog", async ({
    page,
    context,
  }) => {
    const actor = await createTestUser({
      name: "Publish Flow Data Actor",
      email: `publish-flow-data-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory(
      { name: `Publish Flow Categoria ${Date.now()}` },
      actor.id,
    );
    // deleteMany, not delete: a no-op (not a P2025 throw) if this row is
    // already gone by the time cleanup runs — e.g. the test failed before
    // reaching a later step, or a retry re-ran cleanup against stale state.
    cleanup.push(() => prisma.category.deleteMany({ where: { id: category.id } }));

    // Deliberately incomplete: no category, no price, no variants — so
    // there are real blockers to review and resolve through the admin UI.
    const uniqueName = `Producto Incompleto ${Date.now()}`;
    const product = await createProduct({ name: uniqueName }, actor.id);
    cleanup.push(() => prisma.product.deleteMany({ where: { id: product.id } }));

    // 1. Log in as ADMIN.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    // 2. Confirm "Ir al panel" is visible from the storefront.
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Ir al panel" })).toBeVisible();

    // 3. Open the example product.
    await page.goto(`/admin/products/${product.id}`);
    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

    // 4. Review its visibility blockers.
    await expect(page.getByText("No visible en la tienda")).toBeVisible();
    await expect(page.getByText(/no tiene una categoría asignada/i)).toBeVisible();
    await expect(page.getByText(/no tiene ninguna variante activa/i)).toBeVisible();

    // 5. Complete the required fields: category + price via the edit form.
    await page.getByRole("link", { name: "Editar" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/products/${product.id}/edit`));
    await page.getByLabel("Categoría").click();
    await page.getByRole("option", { name: category.name }).click();
    await page.getByLabel("Precio", { exact: true }).fill("9999");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/products/${product.id}$`));

    // ...and a variant, via the size-less "single variant" shortcut.
    await page
      .getByRole("button", { name: "Proponer variante única (sin talle ni color)" })
      .click();
    await page.getByPlaceholder("SKU").fill(`PUB-${Date.now()}`);
    await page.getByRole("button", { name: /Crear \d+ variante/ }).click();
    await expect(page.getByText("Variantes creadas.")).toBeVisible();
    // Pushed after the product-delete cleanup above so it pops first (LIFO)
    // — the variant, created through the UI itself, must be gone before the
    // product it references can be deleted (product_variant_productId_fkey).
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { productId: product.id } }),
    );

    // 6. Publish it.
    await expect(page.getByText("No visible en la tienda")).toBeVisible();
    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("Producto publicado.")).toBeVisible();
    await expect(page.getByText("Visible en la tienda")).toBeVisible();

    // 7. Use "Ver en la tienda".
    const [storefrontPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: /Ver en la tienda/ }).click(),
    ]);
    await storefrontPage.waitForLoadState();
    await expect(storefrontPage.getByRole("heading", { name: uniqueName })).toBeVisible();

    // 8. Confirm it appears in /catalog.
    await page.goto(`/catalog?q=${encodeURIComponent(uniqueName)}`);
    await expect(page.getByText(uniqueName)).toBeVisible();
  });
});
