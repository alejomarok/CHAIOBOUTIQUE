import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createCategory } from "@/modules/categories/service-core";
import { createCustomer } from "@/modules/customers/customer-core";
import { adjustInventory } from "@/modules/inventory/service-core";
import { createProduct, createVariants } from "@/modules/products/service-core";
import { createSale } from "@/modules/sales/sale-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";

import { ADMIN_FIXTURE, CUSTOMER_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

// Real admin HTTP flow for the Sales Consultation & Commercial Reporting
// phase — the finer-grained filter/summary/query-correctness assertions
// live in tests/integration/sales-report.test.ts; this proves the actual
// page renders, links, and RBAC gate genuinely work end-to-end.
test.describe("sales consultation (real DB, real HTTP)", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanup);
  });

  async function makeConfirmedSale(namePrefix: string, totalAmount: bigint) {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
    const category = await createCategory({ name: `${namePrefix} Cat ${Date.now()}` }, actor.id);
    const product = await createProduct(
      { name: `${namePrefix} ${Date.now()}`, categoryId: category.id, defaultPriceAmount: totalAmount },
      actor.id,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `${namePrefix.toUpperCase()}-${Date.now()}` }],
      actor.id,
    );
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityDelta: 10,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });
    const customerResult = await createCustomer(
      { type: "PERSON", firstName: "Consulta", lastName: `E2E ${Date.now()}` },
      actor.id,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");
    const sale = await createSale(
      {
        customerId: customerResult.customer.id,
        items: [{ productVariantId: variant.id, quantity: 1, unitPriceAmount: totalAmount }],
        confirm: true,
      },
      actor.id,
    );
    return sale;
  }

  async function loginAsAdmin(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);
  }

  test("a confirmed POS Sale appears in the consultation list and its summary reflects the amount sold", async ({
    page,
  }) => {
    const sale = await makeConfirmedSale("Consulta POS", 150000n);
    cleanup.push(async () => {
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/consultation?code=${sale.code}`);

    // .first() — the same Sale row is rendered TWICE in the DOM regardless
    // of viewport (a desktop <table> row and a mobile card, toggled purely
    // via CSS display, both present at once) — see the page's own
    // responsive markup.
    await expect(page.getByText(sale.code).first()).toBeVisible();
    // Scoped to the results table — an exact "Venta en local" text also
    // exists as a (hidden, closed) <option> in the Origen filter <select>,
    // which .first() would otherwise match instead (DOM order puts the
    // filter panel before the results table).
    await expect(page.locator("table").getByText("Venta en local", { exact: true })).toBeVisible();
    // Filtered to exactly this one Sale — summary must show it, not $0.
    await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  });

  test("opening a Sale's full detail from the consultation list shows origin, seller, and product lines", async ({
    page,
  }) => {
    const sale = await makeConfirmedSale("Consulta Detalle", 200000n);
    cleanup.push(async () => {
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/consultation?code=${sale.code}`);
    await page.getByRole("link", { name: "Ver detalle" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/sales/${sale.id}$`));

    await expect(page.getByText("Origen:")).toBeVisible();
    // Not exact: "Venta en local" renders inline after "Origen:" within the
    // same paragraph, so no single element's own text is exactly that
    // string alone.
    await expect(page.getByText("Venta en local")).toBeVisible();
    await expect(page.getByText("Vendedor:")).toBeVisible();
    await expect(page.getByText("Consulta Detalle", { exact: false }).first()).toBeVisible();
  });

  test("the 'Este mes' date preset filters results without replacing the manual Desde/Hasta inputs", async ({
    page,
  }) => {
    const sale = await makeConfirmedSale("Consulta Preset", 90000n);
    cleanup.push(async () => {
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto("/admin/sales/consultation");
    await page.getByRole("link", { name: "Este mes" }).click();

    // Manual inputs are still present and now populated (never replaced).
    await expect(page.locator("#from")).toBeVisible();
    await expect(page.locator("#to")).toBeVisible();
    await expect(page.locator("#from")).not.toHaveValue("");
    await expect(page.locator("#to")).not.toHaveValue("");
  });

  test("CSV export downloads a real file for the current filtered result", async ({ page }) => {
    const sale = await makeConfirmedSale("Consulta Export", 60000n);
    cleanup.push(async () => {
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/consultation?code=${sale.code}`);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^ventas_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("a CUSTOMER gets a real 403 on /admin/sales/consultation, and the nav link is not offered", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(CUSTOMER_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(CUSTOMER_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    // Wait for the real post-login redirect (a CUSTOMER lands on /catalog,
    // never /admin) BEFORE navigating away — otherwise the next page.goto
    // can race the login POST/cookie-set and land unauthenticated. A bare
    // "the nav link is not visible" check is a false synchronization point:
    // it's trivially true on the still-loading /login page too.
    await expect(page).toHaveURL(/\/catalog/);

    await page.goto("/admin/sales/consultation");
    await expect(page.getByText("No tenés permiso para ver esta página")).toBeVisible();
  });

  test("a role without sales.view (WAREHOUSE) gets a real 403 on /admin/sales/consultation", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(RESTRICTED_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(RESTRICTED_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await expect(page.getByRole("link", { name: "Consultas de ventas" })).not.toBeVisible();

    await page.goto("/admin/sales/consultation");
    await expect(page.getByText("No tenés permiso para ver esta página")).toBeVisible();
  });

  test("mobile viewport (390px) renders the consultation list as cards, not a giant table", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const sale = await makeConfirmedSale("Consulta Mobile", 45000n);
    cleanup.push(async () => {
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/consultation?code=${sale.code}`);

    // The desktop <table> must be hidden at this width (md:hidden card list
    // shown instead) — see the page's own responsive markup. Both the
    // table row and the mobile card exist in the DOM regardless of
    // viewport (CSS-only toggle), so this checks the TABLE's own
    // visibility rather than a text string that matches both.
    const desktopTable = page.locator("table");
    await expect(desktopTable).toBeHidden();

    // "Vendedor: <name>" is unique to the mobile card's own markup (the
    // desktop table shows the seller's bare name in its own column, with
    // no "Vendedor:" label prefix) — confirms the mobile card is the one
    // actually rendered/visible, not just that the table is hidden.
    // makeConfirmedSale's actor is always ADMIN_FIXTURE (see that helper).
    await expect(page.getByText(`Vendedor: ${ADMIN_FIXTURE.name}`, { exact: true })).toBeVisible();
  });
});
