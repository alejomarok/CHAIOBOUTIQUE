import { expect, test } from "@playwright/test";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

test("admin fixture can log in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
  await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
});

test("unauthenticated access to /admin redirects to /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("a restricted-role user gets a real 403, not just a hidden menu item", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RESTRICTED_FIXTURE.email);
  await page.getByLabel("Contraseña").fill(RESTRICTED_FIXTURE.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // WAREHOUSE has no users.view permission — proves server-side
  // authorization blocks the page, not just UI hiding of the nav link.
  const response = await page.goto("/admin/users");
  expect(response?.status()).toBe(403);
  await expect(page.getByText("No tenés permiso para ver esta página")).toBeVisible();
});
