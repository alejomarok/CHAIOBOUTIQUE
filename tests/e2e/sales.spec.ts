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

    // 1. Ir a Ventas -> Nueva venta. exact: true — the "Comercial" nav
    // group also has a "Consultas de ventas" link since the Sales
    // Consultation & Commercial Reporting phase, which fuzzy-matches
    // "Ventas" too without this.
    await page.getByRole("link", { name: "Ventas", exact: true }).click();
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

  test("registers a partial payment, then a second payment reaching PAID, and shows both in the payment history", async ({
    page,
  }) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });

    const category = await createCategory({ name: `Pagos E2E Cat ${Date.now()}` }, actor.id);
    const product = await createProduct(
      {
        name: `Pagos E2E Producto ${Date.now()}`,
        categoryId: category.id,
        defaultPriceAmount: 100000n,
      },
      actor.id,
    );
    const sku = `PAY-E2E-${Date.now()}`;
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

    // 1. Crear y confirmar una venta de $1.000,00 (total de la venta, un
    // solo ítem a ese precio).
    await page.goto("/admin/sales/new");
    await page.getByPlaceholder("Buscar por nombre, SKU o código de barras").fill(sku);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText(sku, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    await expect(page.getByText("Confirmada", { exact: true })).toBeVisible();
    const saleId = page.url().split("/").pop()!;

    // 2. Todavía no hay pagos — "Sin pagar".
    await expect(page.getByText("Sin pagar")).toBeVisible();

    // 3. Registrar un pago parcial por transferencia: $600,00 de $1.000,00.
    await page.getByRole("button", { name: "Registrar pago" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Transferencia" }).click();
    await dialog.getByLabel("Referencia / número de operación").fill("OP-98765");
    await dialog.getByLabel("Importe").fill("600,00");
    await dialog.getByRole("button", { name: "Registrar pago" }).click();
    await expect(page.getByText("Pago registrado correctamente.")).toBeVisible({ timeout: 10_000 });
    // The dialog's own subtitle also shows the just-updated "Saldo
    // pendiente" figure for a moment while closing — wait for it to be
    // fully gone before reading the figure from the page behind it,
    // otherwise both spans match ambiguously.
    await expect(dialog).not.toBeVisible();

    // 4. El detalle se actualiza sin recargar manualmente: saldo pendiente
    // $400,00, estado "Pago parcial". A regex on the bare digits (not the
    // literal "$" prefix) — same approach as the existing confirmed-sale
    // test above, since Intl's exact currency-symbol spacing isn't worth
    // pinning to.
    await expect(page.getByText("Pago parcial")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/400,00/)).toBeVisible();

    // 5. Registrar el pago restante en efectivo — sin campo de referencia
    // (no es relevante para efectivo).
    await page.getByRole("button", { name: "Registrar pago" }).click();
    await expect(dialog.getByLabel("Importe")).toBeVisible();
    await expect(dialog.getByLabel("Referencia / número de operación")).not.toBeVisible();
    await dialog.getByLabel("Importe").fill("400,00");
    await dialog.getByRole("button", { name: "Registrar pago" }).click();
    await expect(page.getByText("Pago registrado correctamente.")).toBeVisible({ timeout: 10_000 });
    await expect(dialog).not.toBeVisible();

    // 6. Ahora "Pagada" — sin recarga manual. (The exact final $0,00 saldo
    // figure isn't asserted via text here since "0,00" also legitimately
    // appears in the always-zero Descuentos/Impuestos rows on this page;
    // the DB assertions below cover the exact figure precisely instead.)
    await expect(page.getByText("Pagada", { exact: true })).toBeVisible({ timeout: 10_000 });

    // 7. El historial de pagos muestra ambos movimientos, con medio, monto
    // y referencia cuando corresponde.
    await expect(page.getByText("Transferencia")).toBeVisible();
    await expect(page.getByText("Ref: OP-98765")).toBeVisible();
    await expect(page.getByText("Efectivo")).toBeVisible();

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.paidAmount).toBe(100000n);
    expect(sale.paymentStatus).toBe("PAID");
  });

  test("a payment cannot exceed the remaining balance, and cancelling a sale with an active payment is blocked", async ({
    page,
  }) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });

    const category = await createCategory({ name: `Pagos E2E Cat B ${Date.now()}` }, actor.id);
    const product = await createProduct(
      {
        name: `Pagos E2E Producto B ${Date.now()}`,
        categoryId: category.id,
        defaultPriceAmount: 100000n,
      },
      actor.id,
    );
    const sku = `PAY-E2E-B-${Date.now()}`;
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
      quantityDelta: 5,
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
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/[a-z0-9]{20,}$/, { timeout: 15_000 });

    // Un pago que supera el total ($2.000,00 sobre una venta de $1.000,00)
    // es rechazado por el servidor.
    await page.getByRole("button", { name: "Registrar pago" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Importe").fill("2000,00");
    await dialog.getByRole("button", { name: "Registrar pago" }).click();
    await expect(page.getByText(/supera el saldo pendiente/)).toBeVisible({ timeout: 10_000 });
    // Scoped to the dialog — "Cancelar" would otherwise also substring-match
    // the page's own "Cancelar venta" button.
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    // Wait for the close animation to fully finish before reopening —
    // otherwise the reopened dialog's own open animation can race with the
    // previous instance's close animation and detach the element mid-click.
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Sin pagar")).toBeVisible();

    // Un pago válido dentro del saldo se registra normalmente...
    await page.getByRole("button", { name: "Registrar pago" }).click();
    await dialog.getByLabel("Importe").fill("1000,00");
    await dialog.getByRole("button", { name: "Registrar pago" }).click();
    await expect(page.getByText("Pagada", { exact: true })).toBeVisible({ timeout: 10_000 });

    // ...y ahora cancelar la venta está bloqueado mientras el pago siga activo.
    await page.getByRole("button", { name: "Cancelar venta" }).click();
    await page.getByPlaceholder("Motivo de cancelación (obligatorio)").fill("cliente se arrepintió");
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByText(/tiene pagos registrados/)).toBeVisible({ timeout: 10_000 });

    // Anular el pago primero...
    await page.getByRole("button", { name: "Anular pago" }).click();
    await page.getByPlaceholder("Motivo de anulación (obligatorio)").fill("venta se cancela");
    await page.getByRole("button", { name: "Confirmar anulación" }).click();
    await expect(page.getByText("Sin pagar")).toBeVisible({ timeout: 10_000 });

    // Reload for a clean "Cancelar venta" trigger — the earlier blocked
    // attempt left CancelSaleButton's own local "confirming" state expanded
    // (it isn't reset on error), which a reload sidesteps entirely rather
    // than depending on that incidental client-state detail.
    await page.reload();

    // ...y ahora cancelar la venta funciona.
    await page.getByRole("button", { name: "Cancelar venta" }).click();
    await page.getByPlaceholder("Motivo de cancelación (obligatorio)").fill("cliente se arrepintió");
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible({ timeout: 10_000 });
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
