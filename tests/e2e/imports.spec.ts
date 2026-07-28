import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

async function login(page: import("@playwright/test").Page, fixture: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("Contraseña").fill(fixture.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.describe("admin CSV import — real HTTP round trip", () => {
  test("ADMIN can preview and then execute a CATEGORIES import from the UI", async ({ page }) => {
    await login(page, ADMIN_FIXTURE);
    await page.goto("/admin/imports/products");

    // Switch the import type away from the PRODUCTS default — CATEGORIES
    // needs no pre-existing catalog data, keeping this test self-contained.
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Categorías" }).click();

    await page.getByLabel("Sistema de origen").fill(`e2e-src-${Date.now()}`);

    const legacyId = `E2E-CAT-${Date.now()}`;
    const csv = `legacyId,name,parentLegacyId,description,displayOrder\n${legacyId},Categoria E2E,,,0\n`;
    await page.locator('input[name="file"]').setInputFiles({
      name: "categorias.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

    await page.getByRole("button", { name: "Vista previa" }).click();
    await expect(page.getByText("1 de 1 filas válidas")).toBeVisible();

    const executeButton = page.getByRole("button", { name: "Confirmar e importar" });
    await expect(executeButton).toBeEnabled();
    await executeButton.click();
    await expect(page.getByText("1 de 1 filas válidas")).toBeVisible();

    // The batch shows up in the history table with a completed status.
    await expect(page.getByText("Completado", { exact: true }).first()).toBeVisible();

    const created = await prisma.category.findFirst({ where: { legacyId } });
    expect(created).not.toBeNull();
    if (created) await prisma.category.delete({ where: { id: created.id } });
  });

  test("a role without product_imports.view gets a real 403 on /admin/imports/products", async ({
    page,
  }) => {
    await login(page, RESTRICTED_FIXTURE);
    const response = await page.goto("/admin/imports/products");
    expect(response?.status()).toBe(403);
  });
});
