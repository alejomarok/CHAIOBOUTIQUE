import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service-core";
import { createProduct } from "@/modules/products/service-core";

import { ADMIN_FIXTURE } from "./fixture-credentials";

// A minimal valid 1x1 PNG, so the real upload pipeline's file-signature
// check accepts it as a genuine image, not just a declared MIME type.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// Full admin round trip over real HTTP against TEST_DATABASE_URL, following
// the Product Flow Stabilization Sprint's guided single-page workflow:
// login → confirm the role-aware dashboard button from the storefront →
// open an example product missing required data → review the "why isn't
// this public" panel → complete category/price/variants → load stock →
// upload an image → publish → "Ver en la tienda" → confirm it appears in
// /catalog.
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

  test("login as ADMIN, see 'Ir al panel' from the storefront, complete an incomplete product, load stock, upload an image, publish it, and confirm it appears in /catalog", async ({
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

    // 4. Review why it isn't public — the guided "why not visible" panel,
    // in plain Spanish, with the exact getVisibilityBlockers() reasons.
    await expect(
      page.getByText("Este producto todavía no aparece en la tienda"),
    ).toBeVisible();
    await expect(page.getByText(/no tiene una categoría asignada/i)).toBeVisible();
    await expect(page.getByText(/no tiene ninguna variante activa/i)).toBeVisible();
    await expect(page.getByText("Visible en el catálogo")).toBeVisible();

    // 5. Complete the required fields: category + price via the edit form.
    await page.getByRole("link", { name: "Editar" }).first().click();
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
    cleanup.push(() => prisma.productVariant.deleteMany({ where: { productId: product.id } }));

    // 6. Load stock for the new variant — the guided stock section's own
    // "Cargar stock inicial" action, pre-selecting this exact variant.
    await page.reload();
    await expect(page.getByText("Las variantes de este producto todavía no tienen stock")).toBeVisible();
    await page.getByRole("link", { name: "Cargar stock inicial" }).click();
    await expect(page).toHaveURL(/\/admin\/inventory\/adjustments/);
    await page.getByLabel("Depósito").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Cantidad").fill("8");
    await page.getByLabel("Motivo").fill("Carga inicial (e2e)");
    await page.getByRole("button", { name: "Registrar movimiento" }).click();
    await expect(page.getByText("Movimiento registrado.")).toBeVisible();

    // 7. Upload a real image through the actual form.
    await page.goto(`/admin/products/${product.id}`);
    await expect(page.getByText("Stock total del producto: 8 unidades")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "publish-flow.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Imagen subida correctamente.")).toBeVisible({ timeout: 15_000 });

    // 8. Publish it.
    await expect(
      page.getByText("Este producto todavía no aparece en la tienda"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("Producto publicado.")).toBeVisible();
    await expect(
      page.getByText("Este producto todavía no aparece en la tienda"),
    ).not.toBeVisible();

    // 9. Use "Ver en la tienda".
    const [storefrontPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: /Ver en la tienda/ }).click(),
    ]);
    await storefrontPage.waitForLoadState();
    await expect(storefrontPage.getByRole("heading", { name: uniqueName })).toBeVisible();

    // 10. Confirm it appears in /catalog.
    await page.goto(`/catalog?q=${encodeURIComponent(uniqueName)}`);
    await expect(page.getByText(uniqueName)).toBeVisible();
  });
});
