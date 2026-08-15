import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

test.describe("admin customer management (real DB, real HTTP)", () => {
  test("login, create a PERSON customer, reach its detail page, add and edit an address, find it by name and by DNI, and edit it", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    // 1. Ir a Clientes.
    await page.getByRole("link", { name: "Clientes" }).click();
    await expect(page).toHaveURL(/\/admin\/customers$/);

    // 2. Nuevo cliente.
    await page.getByRole("link", { name: "Nuevo cliente" }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/new/);

    // The last 8 digits, not the first — Date.now()'s leading digits barely
    // change within a test run (or across two nearby runs against a
    // non-reset DB); slice(0, 8) produced near-identical "unique" IDs.
    const documentNumber = String(Date.now()).slice(-8);
    const uniqueName = `Juan E2E ${Date.now()}`;
    const email = `juan-e2e-${Date.now()}@test.chaioboutique.local`;

    await page.getByLabel("Nombre").fill(uniqueName);
    await page.getByLabel("Apellido").fill("Pérez");
    await page.getByLabel("Número de documento").fill(documentNumber);
    await page.getByLabel("Email (opcional)").fill(email);
    await page.getByLabel("Teléfono (opcional)").fill("11 5555-5555");
    await page.getByRole("button", { name: "Crear cliente" }).click();

    // 3. Llega al detalle del cliente.
    await expect(page).toHaveURL(/\/admin\/customers\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: `${uniqueName} Pérez` })).toBeVisible();
    await expect(page.getByText("Cuenta online: No")).toBeVisible();

    const customerId = page.url().split("/").pop()!;

    // 4. Agregar una dirección de envío.
    await page.getByRole("button", { name: "Agregar dirección" }).click();
    await page.getByLabel("Calle").fill("Av. Siempre Viva");
    await page.getByLabel("Número").fill("742");
    await page.getByLabel("Ciudad").fill("Springfield");
    await page.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(page.getByText("Av. Siempre Viva 742")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Envío predeterminado")).toBeVisible();

    // 5. Editar esa dirección.
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Calle").fill("Av. Siempre Viva Editada");
    await page.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(page.getByText("Av. Siempre Viva Editada 742")).toBeVisible({ timeout: 10_000 });

    // 6. Volver a la lista y buscar por nombre.
    await page.goto("/admin/customers");
    await page.getByLabel("Buscar").fill(uniqueName);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("link", { name: `${uniqueName} Pérez` })).toBeVisible();

    // 7. Buscar por DNI y encontrar el mismo cliente.
    await page.goto("/admin/customers");
    await page.getByLabel("Buscar").fill(documentNumber);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("link", { name: `${uniqueName} Pérez` })).toBeVisible();

    // 8. Editar el cliente.
    await page.goto(`/admin/customers/${customerId}/edit`);
    await page.getByLabel("Teléfono (opcional)").fill("11 4444-4444");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/customers/${customerId}$`), { timeout: 15_000 });
    // Displayed already-normalized (digits only) — see modules/customers/
    // normalize.ts's normalizePhone, applied at write time. Shown both in
    // the compact header line and in "Datos generales" — .first() is
    // enough to prove the save worked, without over-specifying which of
    // the two the test cares about.
    await expect(page.getByText("1144444444").first()).toBeVisible();

    // Cleanup — the address cascades with the customer.
    await prisma.customer.delete({ where: { id: customerId } });
  });

  test("creating a second customer with the same DNI shows a duplicate warning instead of silently creating one", async ({
    page,
  }) => {
    const documentNumber = String(Date.now()).slice(-8);

    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto("/admin/customers/new");
    await page.getByLabel("Nombre").fill("Primero");
    await page.getByLabel("Número de documento").fill(documentNumber);
    await page.getByRole("button", { name: "Crear cliente" }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    const firstCustomerId = page.url().split("/").pop()!;

    // A second customer with the exact same DNI: the server rejects it
    // outright (a real DB unique constraint, not just a soft warning) — see
    // modules/customers/customer-core.ts's DuplicateCustomerDocumentError.
    await page.goto("/admin/customers/new");
    await page.getByLabel("Nombre").fill("Segundo");
    await page.getByLabel("Número de documento").fill(documentNumber);
    await page.getByRole("button", { name: "Crear cliente" }).click();
    await expect(page.getByText("Ya existe un cliente con este número de documento.")).toBeVisible({
      timeout: 10_000,
    });

    // Confirms no duplicate was silently created.
    const count = await prisma.customer.count({
      where: { documentType: "DNI", documentNumberNormalized: documentNumber },
    });
    expect(count).toBe(1);

    await prisma.customer.delete({ where: { id: firstCustomerId } });
  });

  test("Consumidor Final exists, is marked as a system customer, and has no edit/deactivate actions", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    const consumidorFinal = await prisma.customer.findFirstOrThrow({
      where: { isSystemDefault: true },
    });

    await page.goto(`/admin/customers/${consumidorFinal.id}`);
    // exact: true — the seed's own notes text ("Cliente del sistema para
    // ventas rápidas...") also contains this substring, which a non-exact
    // match would also hit, tripping Playwright's strict-mode check.
    await expect(page.getByText("Cliente del sistema", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Editar cliente" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Desactivar cliente" })).not.toBeVisible();

    // A direct URL visit to the edit route is refused too, not just hidden
    // — see src/app/(admin)/admin/customers/[id]/edit/page.tsx's
    // notFound() call for a system customer.
    await page.goto(`/admin/customers/${consumidorFinal.id}/edit`);
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("a role without customers.view gets a real 403 on /admin/customers", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(RESTRICTED_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(RESTRICTED_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await expect(page.getByRole("link", { name: "Clientes" })).not.toBeVisible();

    await page.goto("/admin/customers");
    await expect(page.getByText("No tenés permiso para ver esta página")).toBeVisible();
  });
});
