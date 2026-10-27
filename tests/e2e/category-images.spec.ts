import { expect, test } from "@playwright/test";
import path from "node:path";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { createCategory } from "@/modules/categories/service-core";
import { createProduct } from "@/modules/products/service-core";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

// Real HTTP against the isolated Docker test database + the in-memory
// e2e storage provider (see modules/storage/e2e-provider.ts, selected
// automatically under E2E_TEST_MODE — the real product-images bucket is
// never touched). Storage-boundary edge cases (orphan cleanup, path
// rejection) are covered at the integration level
// (tests/integration/category-images.test.ts); this proves the real admin
// UI -> Server Action -> storage -> home-tile round trip actually works.
test.describe("admin-controlled category images (real DB, real HTTP)", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup.length = 0;
  });

  async function loginAsAdmin(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);
  }

  async function makeCategoryWithProduct(namePrefix: string) {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
    const category = await createCategory(
      { name: `${namePrefix} ${Date.now()}`, showInStorefrontNav: true },
      actor.id,
    );
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));
    return category;
  }

  const TEST_IMAGE_PATH = path.join(__dirname, "..", "fixtures", "assets", "test-image.png");

  test("creating a category with an image: preview, upload, and it appears on the admin list", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/categories");

    const categoryName = `E2E Con Imagen ${Date.now()}`;
    await page.getByRole("button", { name: "Nueva categoría" }).click();
    await page.getByLabel("Nombre").fill(categoryName);
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_PATH);

    // Client-side preview appears before any upload happens.
    await expect(page.getByText("test-image.png")).toBeVisible();

    await page.getByRole("button", { name: "Crear categoría" }).click();
    await expect(page.getByText("Categoría creada.")).toBeVisible();

    const row = page.locator("tr", { hasText: categoryName });
    await expect(row).toBeVisible();
    // The thumbnail column renders a real <img>, not the "no image" icon.
    await expect(row.locator("img")).toBeVisible();

    const category = await prisma.category.findFirstOrThrow({ where: { name: categoryName } });
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));
    expect(category.imageBucket).toBeTruthy();
    expect(category.imagePath).toBeTruthy();
  });

  test("editing a category: replacing its image updates the DB and the preview, and removing it clears both", async ({
    page,
  }) => {
    const category = await makeCategoryWithProduct("E2E Editar");
    await loginAsAdmin(page);

    await page.goto(`/admin/categories/${category.id}`);
    await expect(page.getByText("Esta categoría todavía no tiene imagen.")).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_PATH);
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Imagen subida correctamente.")).toBeVisible();

    const afterUpload = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(afterUpload.imageBucket).toBeTruthy();
    const firstPath = afterUpload.imagePath;

    // Replace — a second selection while an image already exists.
    await page.reload();
    await expect(page.getByRole("button", { name: "Cambiar imagen" })).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_PATH);
    await page.getByRole("button", { name: "Cambiar imagen" }).click();
    await expect(page.getByText("Imagen actualizada.")).toBeVisible();

    const afterReplace = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(afterReplace.imagePath).not.toBe(firstPath);

    // Delete.
    await page.reload();
    await page.getByRole("button", { name: "Eliminar imagen" }).click();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Imagen eliminada.")).toBeVisible();

    const afterDelete = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(afterDelete.imageBucket).toBeNull();
    expect(afterDelete.imagePath).toBeNull();
  });

  test("an invalid file selection is rejected client-side with a clear Spanish message", async ({
    page,
  }) => {
    const category = await makeCategoryWithProduct("E2E Invalido");
    await loginAsAdmin(page);
    await page.goto(`/admin/categories/${category.id}`);
    // See the "home shows..." test's own comment on this same wait: a
    // native <input>'s onChange only attaches once React hydrates, so
    // interacting immediately after goto can drop the event entirely.
    await page.waitForLoadState("networkidle");

    // Explicit {name, mimeType, buffer} form — forces file.type to a real,
    // unambiguous "application/pdf" rather than relying on the OS/browser
    // to infer a MIME type from a bare path (validateSelectedImageFile
    // checks file.type directly, so an inferred/empty type would make this
    // test meaningless either way).
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "not-an-image.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
      });
    await expect(page.getByText("Formato no permitido. Usá JPG, PNG o WebP.")).toBeVisible();
  });

  test("a role without categories.manage cannot reach the image upload/replace/delete controls", async ({
    page,
  }) => {
    const category = await makeCategoryWithProduct("E2E Sin Permiso");

    await page.goto("/login");
    await page.getByLabel("Email").fill(RESTRICTED_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(RESTRICTED_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto(`/admin/categories/${category.id}`);

    const blocked = await page
      .getByText("No tenés permiso para ver esta página")
      .isVisible()
      .catch(() => false);
    if (!blocked) {
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Guardar cambios" })).not.toBeVisible();
    }
  });

  test("home shows a category's explicit image, and it wins over a product image once configured", async ({
    page,
  }) => {
    // Two categories with real published products, so the home tiles
    // section actually renders (it needs 2+ eligible categories — see
    // components/home/category-tiles.tsx).
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
    const withImage = await makeCategoryWithProduct("E2E Home Con Imagen");
    const withoutImage = await makeCategoryWithProduct("E2E Home Sin Imagen");

    // Both need at least one product to be eligible for a home tile —
    // listStorefrontNavCategories's own _count.products counts every
    // Product regardless of status, so DRAFT is enough here; this test
    // isn't exercising the published-product-image fallback itself, only
    // that a category WITH its own image wins and a category WITHOUT one
    // still renders a tile instead of breaking the section.
    for (const category of [withImage, withoutImage]) {
      const product = await createProduct(
        { name: `${category.name} Producto`, categoryId: category.id, defaultPriceAmount: 15000n },
        actor.id,
      );
      cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));
    }

    await loginAsAdmin(page);
    await page.goto(`/admin/categories/${withImage.id}`);
    // Explicit hydration guard: this native <input> exists in the SSR'd
    // HTML immediately, but its onChange handler only attaches once React
    // hydrates — interacting before that lets setInputFiles's change event
    // fire into a page that silently drops it (a real, observed flake here
    // once force-dynamic removed this route's static-shell head start).
    // waitForLoadState("networkidle") is the standard Playwright signal
    // that client-side JS has settled.
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_PATH);
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Imagen subida correctamente.")).toBeVisible();

    const updatedWithImage = await prisma.category.findUniqueOrThrow({
      where: { id: withImage.id },
    });

    await page.goto("/");
    // Scoped to the home tiles section specifically — the category's own
    // name ALSO appears as a header nav pill (showInStorefrontNav renders
    // it there too, by design), which a bare page-wide `a` locator would
    // ambiguously match as well.
    const tilesSection = page.locator('section[aria-labelledby="categories-title"]');
    const tile = tilesSection.locator("a", { hasText: withImage.name });
    await expect(tile).toBeVisible();
    const img = tile.locator("img").first();
    // next/image rewrites the real src into its own optimizer URL
    // (/_next/image?url=<encoded original>&...) — assert against the
    // URL-encoded form of the real category image path, not the raw path.
    const encodedImagePath = encodeURIComponent(
      `/api/e2e-storage/${updatedWithImage.imageBucket}/${updatedWithImage.imagePath}`,
    );
    await expect(img).toHaveAttribute(
      "src",
      new RegExp(encodedImagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    // The category with no image configured still renders a tile (falls
    // back gracefully — never breaks the home) even though it has no
    // category image of its own.
    await expect(tilesSection.locator("a", { hasText: withoutImage.name })).toBeVisible();
  });
});
