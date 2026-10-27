import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createCategory } from "@/modules/categories/service-core";
import { adjustInventory } from "@/modules/inventory/service-core";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";

import { ADMIN_FIXTURE } from "./fixture-credentials";

// Full product -> cart -> checkout -> Order -> "Pagar con Mercado Pago" ->
// fake provider approval -> REAL webhook (signature-verified) ->
// reconciliation -> return page -> admin Order detail journey, over real
// HTTP against the isolated Docker test database. Uses
// FakeMercadoPagoClient exclusively (see modules/payments/mercado-pago/
// fake-client-core.ts) — this suite never reaches the real Mercado Pago
// API, but DOES exercise the real webhook route's real signature
// verification end-to-end (see src/app/api/e2e-mercado-pago/checkout's own
// comment for why).
test.describe("Mercado Pago Checkout Pro (real DB, real HTTP, fake provider)", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanup);
  });

  async function setUpSellableProduct(namePrefix: string, priceAmount: bigint, stock: number) {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
    const category = await createCategory({ name: `${namePrefix} Cat ${Date.now()}` }, actor.id);
    const productName = `${namePrefix} ${Date.now()}`;
    const product = await createProduct(
      { name: productName, categoryId: category.id, defaultPriceAmount: priceAmount },
      actor.id,
    );
    const sku = `${namePrefix.toUpperCase().replace(/\s+/g, "-")}-${Date.now()}`;
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
      quantityDelta: stock,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });
    await setProductStatus(product.id, "ACTIVE", actor.id);
    return { productName, variant, warehouse, actor };
  }

  async function checkoutToOrderConfirmation(
    page: import("@playwright/test").Page,
    productName: string,
    email: string,
  ) {
    await page.goto(`/catalog?q=${encodeURIComponent(productName)}`);
    await page.getByText(productName).click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByText("Se agregó al carrito.")).toBeVisible();

    await page.goto("/cart");
    await page.getByRole("link", { name: "Continuar a la compra" }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await page.getByLabel("Nombre").fill("Paga");
    await page.getByLabel("Apellido").fill("Conmercadopago");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByText("Retiro", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByText(productName)).toBeVisible();
    await page.getByRole("checkbox", { name: /Acepto los/ }).check();
    await page.getByRole("button", { name: "Confirmar pedido" }).click();
    await expect(page).toHaveURL(/\/order\/[A-Za-z0-9_-]{40,}$/, { timeout: 15_000 });
  }

  test("approved payment: full journey from product to confirmed Sale with physically reduced stock", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { productName, variant, warehouse } = await setUpSellableProduct(
      "MP Checkout",
      150000n,
      5,
    );
    const email = `mp-e2e-${Date.now()}@test.chaioboutique.local`;

    await checkoutToOrderConfirmation(page, productName, email);

    const orderCodeText = await page.locator("h1").textContent();
    const orderCode = orderCodeText!.match(/PED-\S+/)![0];
    const order = await prisma.order.findUniqueOrThrow({ where: { code: orderCode } });
    cleanup.push(async () => {
      await prisma.salePayment.deleteMany({ where: { sale: { orderId: order.id } } });
      await prisma.saleItem.deleteMany({ where: { sale: { orderId: order.id } } });
      await prisma.sale.deleteMany({ where: { orderId: order.id } });
      await prisma.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await prisma.orderPaymentAttempt.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.emailOutbox.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });

    // "Pagar con Mercado Pago" -> real fake-checkout redirect.
    await page.getByRole("button", { name: "Pagar con Mercado Pago" }).click();
    await expect(page).toHaveURL(/\/api\/e2e-mercado-pago\/checkout/, { timeout: 10_000 });
    await expect(page.getByTestId("fake-mp-amount")).toBeVisible();

    // Approve -> fake checkout route fires a REAL, validly-signed webhook to
    // /api/webhooks/mercado-pago, then redirects to the return route.
    await page.getByTestId("fake-mp-approved").click();
    await expect(page).toHaveURL(/\/order\/[A-Za-z0-9_-]{40,}\/payment\/return/, {
      timeout: 10_000,
    });
    await expect(page.getByText("¡Pago confirmado!")).toBeVisible({ timeout: 10_000 });

    // Server state is genuinely PAID — never just a redirect hint.
    const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paidOrder.status).toBe("PAID");
    expect(paidOrder.paymentStatus).toBe("PAID");

    const sale = await prisma.sale.findUnique({
      where: { orderId: order.id },
      include: { items: true, payments: true },
    });
    expect(sale?.status).toBe("CONFIRMED");
    expect(sale?.paymentStatus).toBe("PAID");
    expect(sale?.payments[0]?.method).toBe("MERCADO_PAGO");

    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
    });
    expect(balance.quantity).toBe(4); // 5 - 1, physically deducted exactly once
    expect(balance.reservedQuantity).toBe(0);

    // Revisiting the order page never shows the payment button again, and
    // shows the confirmed state instead.
    await page.goto(`/order/${page.url().match(/\/order\/([A-Za-z0-9_-]{40,})/)![1]}`);
    await expect(page.getByText("¡Pago confirmado!")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pagar con Mercado Pago" })).not.toBeVisible();

    // Admin sees the payment on the Order detail page.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto(`/admin/orders/${order.id}`);
    await expect(page.getByText("Mercado Pago").first()).toBeVisible();
    await expect(page.getByText("Aprobado")).toBeVisible();
    await expect(page.getByRole("link", { name: sale!.code })).toBeVisible();
  });

  test("rejected payment: customer can retry while the reservation remains valid", async ({
    page,
  }) => {
    const { productName } = await setUpSellableProduct("MP Rejected", 80000n, 5);
    const email = `mp-e2e-rejected-${Date.now()}@test.chaioboutique.local`;

    await checkoutToOrderConfirmation(page, productName, email);
    const orderCodeText = await page.locator("h1").textContent();
    const orderCode = orderCodeText!.match(/PED-\S+/)![0];
    const order = await prisma.order.findUniqueOrThrow({ where: { code: orderCode } });
    cleanup.push(async () => {
      await prisma.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await prisma.orderPaymentAttempt.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.emailOutbox.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });

    await page.getByRole("button", { name: "Pagar con Mercado Pago" }).click();
    await expect(page).toHaveURL(/\/api\/e2e-mercado-pago\/checkout/);
    await page.getByTestId("fake-mp-rejected").click();
    await expect(page).toHaveURL(/\/payment\/return/);
    await expect(page.getByText("El pago no pudo completarse.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Intentar nuevamente" })).toBeVisible();

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("PENDING_PAYMENT");

    await page.getByRole("button", { name: "Intentar nuevamente" }).click();
    await expect(page).toHaveURL(/\/order\/[A-Za-z0-9_-]{40,}$/);
    await expect(page.getByRole("button", { name: "Pagar con Mercado Pago" })).toBeVisible();
  });

  test("mobile viewport (375px): the payment CTA is visible and usable", async ({ page }) => {
    const { productName } = await setUpSellableProduct("MP Mobile", 60000n, 5);
    const email = `mp-e2e-mobile-${Date.now()}@test.chaioboutique.local`;

    await page.setViewportSize({ width: 375, height: 800 });
    await checkoutToOrderConfirmation(page, productName, email);

    const orderCodeText = await page.locator("h1").textContent();
    const orderCode = orderCodeText!.match(/PED-\S+/)![0];
    const order = await prisma.order.findUniqueOrThrow({ where: { code: orderCode } });
    cleanup.push(async () => {
      await prisma.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await prisma.orderPaymentAttempt.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.emailOutbox.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });

    const payButton = page.getByRole("button", { name: "Pagar con Mercado Pago" });
    await expect(payButton).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasOverflow).toBe(false);
  });
});
