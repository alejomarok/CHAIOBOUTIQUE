import { expect, test } from "@playwright/test";
import "../integration/guard";
import { prisma } from "@/lib/db-core";
import { ADMIN_FIXTURE } from "./fixture-credentials";

test("public policies and withdrawal work without an account, and staff can respond from the dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Botón de arrepentimiento", exact: true }).first().click();
  await expect(page).toHaveURL(/\/arrepentimiento$/);
  await expect(
    page.getByRole("heading", { name: "Botón de arrepentimiento", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Nombre y apellido").fill("Cliente de prueba legal");
  await page.getByLabel("Email para responderte").fill("legal-e2e@test.chaioboutique.local");
  await page.getByRole("button", { name: "Enviar solicitud", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Recibimos tu solicitud" }),
  ).toBeVisible();
  const confirmation = await page
    .getByRole("status")
    .filter({ hasText: "Recibimos tu solicitud" })
    .innerText();
  const code = confirmation.match(/SOL-[A-F0-9]+/)?.[0];
  expect(code).toBeTruthy();
  const request = await prisma.consumerRequest.findUniqueOrThrow({ where: { code: code! } });
  expect(request.kind).toBe("WITHDRAWAL");
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(ADMIN_FIXTURE.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(ADMIN_FIXTURE.password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/requests");
  const form = page
    .locator("form")
    .filter({ has: page.locator(`input[name="id"][value="${request.id}"]`) });
  await form.getByRole("combobox", { name: "Estado", exact: true }).selectOption("RESOLVED");
  await form
    .getByLabel("Respuesta para la persona solicitante")
    .fill("Coordinaremos el retiro de la prenda sin costo.");
  await form.getByRole("button", { name: "Guardar respuesta" }).click();
  await expect
    .poll(
      async () =>
        (await prisma.consumerRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    )
    .toBe("RESOLVED");
  await page.goto("/admin/settings/production");
  await expect(page.getByRole("heading", { name: "Preparación para publicar" })).toBeVisible();
  await expect(page.getByText("Titular y CUIT", { exact: true })).toBeVisible();
});

test("legal documents and order recovery remain accessible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, title] of [
    ["terms", "Términos y condiciones"],
    ["privacy", "Política de privacidad"],
    ["shipping", "Envíos y retiros"],
    ["returns", "Cambios y devoluciones"],
    ["recover-order", "Recuperar mi pedido"],
  ]) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByLabel("Email de la compra").fill("nonexistent@test.chaioboutique.local");
  await page.getByLabel("Número de pedido").fill("PED-NONEXISTENT");
  await page.getByRole("button", { name: "Recuperar pedido", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Si el email" })).toBeVisible();
});
