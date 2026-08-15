import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { adjustInventory, getInventoryBalance } from "@/modules/inventory/service-core";
import { createCategory } from "@/modules/categories/service-core";
import { createProduct, createVariants } from "@/modules/products/service-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

test.describe("admin sales/POS foundation (real DB, real HTTP)", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanup);
  });

  test("create a sale for Consumidor Final, add a product, confirm it (deducting stock), then cancel it (restoring stock)", async ({
    page,
  }) => {
    // Test data set up directly through the service layer — this test is
    // about the sales flow, not re-proving product creation (already
    // covered by tests/e2e/product-publish.spec.ts).
    const actorEmail = ADMIN_FIXTURE.email;
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: actorEmail } });

    // No cleanup pushed for category/product/variant below — once this
    // test confirms a sale, its SaleItem permanently references the
    // variant (onDelete: Restrict), which transitively blocks deleting the
    // product and then the category too. Left for the isolated test
    // database's full reset between `npm run test:e2e` runs, same
    // precedent as tests/integration/sales.test.ts and
    // tests/integration/product-stock-summary.test.ts.
    const category = await createCategory({ name: `Ventas E2E Cat ${Date.now()}` }, actor.id);

    const productName = `Ventas E2E Producto ${Date.now()}`;
    const product = await createProduct(
      { name: productName, categoryId: category.id, defaultPriceAmount: 150000n },
      actor.id,
    );

    const sku = `VEN-E2E-${Date.now()}`;
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku }],
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

    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    // 1. Ir a Ventas -> Nueva venta.
    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page).toHaveURL(/\/admin\/sales$/);
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/new/);

    // 2. Consumidor Final is already the default selection for a new sale
    // (the "quick option" requirement — zero clicks needed) — confirmed by
    // the customer picker's own displayed value rather than clicking a
    // button that only appears once a *different* customer is selected.
    await expect(page.getByLabel("Cliente")).toContainText("Consumidor Final");

    // 2b. The default warehouse is pre-selected (ADMIN can see/change it).
    await expect(page.getByLabel("Depósito")).toContainText(warehouse.name);

    // 3. Buscar y agregar el producto — el resultado muestra el stock
    // disponible en el depósito seleccionado.
    await page.getByPlaceholder("Buscar por nombre, SKU o código de barras").fill(sku);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText(sku, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Disponible: 10")).toBeVisible();
    await page.getByRole("button", { name: "Agregar" }).click();

    // 4. Cantidad = 2.
    await page.getByRole("spinbutton").fill("2");

    // 5. Confirmar la venta.
    await page.getByRole("button", { name: "Confirmar venta" }).click();

    // 6. Llega al detalle, confirmada, con el total correcto (2 * $1500 = $3000),
    // el depósito, y la indicación de que el stock fue descontado.
    // Appears 3 times on the page (unit price, line total, and sale total
    // are all coincidentally the same figure here) — .last() is the "Total"
    // row in the Totales card, the one furthest down the page.
    await expect(page).toHaveURL(/\/admin\/sales\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    await expect(page.getByText("Confirmada", { exact: true })).toBeVisible();
    await expect(page.getByText(/3\.000,00/).last()).toBeVisible();
    await expect(page.getByText(`Depósito: ${warehouse.name}`)).toBeVisible();
    await expect(page.getByText("Stock descontado: Sí")).toBeVisible();

    const saleId = page.url().split("/").pop()!;

    const balanceAfterConfirm = await getInventoryBalance(variant.id, warehouse.id);
    expect(balanceAfterConfirm?.quantity).toBe(8);

    // 7. Aparece en la lista, buscable por código.
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    await page.goto("/admin/sales");
    await page.getByLabel("Buscar").fill(sale.code);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("link", { name: sale.code })).toBeVisible();

    // 8. Cancelar la venta — el motivo es obligatorio.
    await page.goto(`/admin/sales/${saleId}`);
    await page.getByRole("button", { name: "Cancelar venta" }).click();
    await expect(page.getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
    await page.getByPlaceholder("Motivo de cancelación (obligatorio)").fill("cliente se arrepintió");
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible({ timeout: 10_000 });

    // A cancelled sale is not editable — no "Cancelar venta" action left.
    await page.reload();
    await expect(page.getByRole("button", { name: "Cancelar venta" })).not.toBeVisible();

    // 9. Cancelar restauró el stock exactamente al valor original.
    const balanceAfterCancel = await getInventoryBalance(variant.id, warehouse.id);
    expect(balanceAfterCancel?.quantity).toBe(10);
  });

  test("confirming a sale that requests more than the available stock is rejected, and stock stays unchanged", async ({
    page,
  }) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });

    const category = await createCategory({ name: `Ventas E2E Stock Cat ${Date.now()}` }, actor.id);
    const product = await createProduct(
      {
        name: `Ventas E2E Stock Producto ${Date.now()}`,
        categoryId: category.id,
        defaultPriceAmount: 100000n,
      },
      actor.id,
    );
    const sku = `VEN-E2E-STOCK-${Date.now()}`;
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku }],
      actor.id,
    );

    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityDelta: 2,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto("/admin/sales/new");
    await page.getByPlaceholder("Buscar por nombre, SKU o código de barras").fill(sku);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText(sku, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Agregar" }).click();

    // Pide más de lo disponible — advertencia inmediata en la línea.
    await page.getByRole("spinbutton").fill("5");
    await expect(page.getByText("Stock insuficiente")).toBeVisible();

    // El servidor revalida igual al confirmar y rechaza toda la venta.
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await expect(page.getByText(/No hay stock suficiente/)).toBeVisible({ timeout: 10_000 });

    // Sigue en la pantalla de creación — la venta nunca se confirmó.
    await expect(page).toHaveURL(/\/admin\/sales\/new/);

    const balance = await getInventoryBalance(variant.id, warehouse.id);
    expect(balance?.quantity).toBe(2);
  });

  test("a role without sales.view gets a real 403 on /admin/sales", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(RESTRICTED_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(RESTRICTED_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await expect(page.getByRole("link", { name: "Ventas" })).not.toBeVisible();

    await page.goto("/admin/sales");
    await expect(page.getByText("No tenés permiso para ver esta página")).toBeVisible();
  });
});
