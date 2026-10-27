import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createCategory } from "@/modules/categories/service-core";
import {
  addCustomerAddress,
  createCustomer,
  linkCustomerToUser,
  unlinkCustomerFromUser,
} from "@/modules/customers/customer-core";
import { adjustInventory } from "@/modules/inventory/service-core";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service-core";
import { updateStoreConfiguration } from "@/modules/store-settings/service-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";

import { ADMIN_FIXTURE, CUSTOMER_FIXTURE } from "./fixture-credentials";

// Full catalog -> product -> cart -> checkout -> order confirmation journey
// over real HTTP against the isolated Docker test database — proves the
// whole Online Orders & Checkout foundation genuinely works end-to-end, not
// just each service function in isolation (see tests/integration/
// orders.test.ts for that finer-grained coverage).
test.describe("checkout (real DB, real HTTP)", () => {
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

  test("guest: catalog -> product -> cart -> checkout -> order confirmation, with no fake User created", async ({
    page,
  }) => {
    const { productName, variant, warehouse } = await setUpSellableProduct(
      "Guest Checkout",
      150000n,
      5,
    );
    const userCountBefore = await prisma.user.count();

    // 1. Catalog -> product -> cart, as a guest.
    await page.goto(`/catalog?q=${encodeURIComponent(productName)}`);
    await page.getByText(productName).click();
    await expect(page).toHaveURL(new RegExp(`/product/`));
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByText("Se agregó al carrito.")).toBeVisible();

    // 2. Cart -> checkout.
    await page.goto("/cart");
    await page.getByRole("link", { name: "Continuar a la compra" }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    // 3. Contacto.
    await page.getByLabel("Nombre").fill("Ana");
    await page.getByLabel("Apellido").fill("Invitada");
    await page.getByLabel("Email").fill(`ana-invitada-${Date.now()}@test.chaioboutique.local`);
    await page.getByRole("button", { name: "Continuar" }).click();

    // 4. Entrega — Retiro (the only method available; no delivery fee is
    // configured for this test by default). exact: true — "Retiro" would
    // otherwise also substring-match the pickup-instructions fallback text
    // ("Te contactaremos para coordinar el retiro.").
    await expect(page.getByText("Retiro", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continuar" }).click();

    // 5. Resumen -> confirmar.
    await expect(page.getByText(productName)).toBeVisible();
    await page.getByRole("checkbox", { name: /Acepto los/ }).check();
    await page.getByRole("button", { name: "Confirmar pedido" }).click();

    // 6. Order confirmation page.
    await expect(page).toHaveURL(/\/order\/[A-Za-z0-9_-]{40,}$/, { timeout: 15_000 });
    await expect(page.getByText("Pendiente de pago")).toBeVisible();
    await expect(page.getByText(productName)).toBeVisible();
    await expect(page.getByText(/reservado durante/)).toBeVisible();

    const orderCode = await page.locator("h1").textContent();
    expect(orderCode).toMatch(/PED-/);

    // 7. No fake User was created for the guest.
    const userCountAfter = await prisma.user.count();
    expect(userCountAfter).toBe(userCountBefore);

    // 8. Cart was converted, not left ACTIVE, and stock was reserved (not
    // physically deducted).
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
    });
    expect(balance.quantity).toBe(5);
    expect(balance.reservedQuantity).toBe(1);

    const order = await prisma.order.findFirstOrThrow({
      where: { contactEmailSnapshot: { contains: "ana-invitada" } },
    });
    cleanup.push(async () => {
      await prisma.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.emailOutbox.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });
  });

  test("authenticated customer: prefilled contact, saved address selection, home delivery, then admin views and cancels it", async ({
    page,
  }) => {
    const { productName } = await setUpSellableProduct("Auth Checkout", 200000n, 5);
    const adminActorId = (
      await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } })
    ).id;
    await updateStoreConfiguration(
      {
        homeDeliveryFlatFeeAmount: 30000n,
        homeDeliveryPostalCodes: "2000",
        homeDeliveryEstimate: "3 a 6 días hábiles",
      },
      adminActorId,
    );
    cleanup.push(() => updateStoreConfiguration({ homeDeliveryFlatFeeAmount: null }, adminActorId));

    // CUSTOMER_FIXTURE's User has no linked commercial Customer by default
    // (tests/fixtures/users.ts's createTestUser calls Better Auth's own
    // sign-up directly, not the app's full registerCustomer flow) — link
    // one here, with a saved address, specifically to exercise the
    // "authenticated, prefilled, pick a saved address" path this test is
    // named for. Unlinked again in cleanup so CUSTOMER_FIXTURE returns to
    // its normal shared-fixture state for any other spec in the suite.
    const customerUser = await prisma.user.findUniqueOrThrow({
      where: { email: CUSTOMER_FIXTURE.email },
    });
    const uniqueEmail = `customer-fixture-${Date.now()}@test.chaioboutique.local`;
    const created = await createCustomer(
      {
        type: "PERSON",
        firstName: "Cliente",
        lastName: "Autenticado",
        email: uniqueEmail,
        phone: "1122334455",
      },
      adminActorId,
    );
    if (created.status !== "created") throw new Error("unreachable — fresh unique email");
    await linkCustomerToUser(created.customer.id, customerUser.id, adminActorId);
    await addCustomerAddress(
      created.customer.id,
      { street: "Av. Existente", city: "Rosario", postalCode: "2000" },
      adminActorId,
    );
    cleanup.push(() => unlinkCustomerFromUser(created.customer.id, adminActorId));

    await page.goto("/login");
    await page.getByLabel("Email").fill(CUSTOMER_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(CUSTOMER_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/catalog/);

    await page.goto(`/catalog?q=${encodeURIComponent(productName)}`);
    await page.getByText(productName).click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByText("Se agregó al carrito.")).toBeVisible();

    await page.goto("/checkout");

    // Contact is prefilled from the customer's linked commercial record —
    // still editable, never blocking.
    await expect(page.getByLabel("Email")).toHaveValue(uniqueEmail);
    await page.getByRole("button", { name: "Continuar" }).click();

    // Envío a domicilio — the saved address is pre-selected by default
    // (this customer now has exactly one), so no address form is needed.
    await page.getByText("Envío a domicilio").click();
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByText(productName)).toBeVisible();
    await expect(page.getByText(/Av\. Existente/)).toBeVisible();
    await page.getByRole("checkbox", { name: /Acepto los/ }).check();
    await page.getByRole("button", { name: "Confirmar pedido" }).click();
    await expect(page).toHaveURL(/\/order\/[A-Za-z0-9_-]{40,}$/, { timeout: 15_000 });
    await expect(page.getByText("Av. Existente")).toBeVisible();

    const orderCodeText = await page.locator("h1").textContent();
    const orderCode = orderCodeText!.match(/PED-\S+/)![0];
    const order = await prisma.order.findUniqueOrThrow({ where: { code: orderCode } });
    expect(order.deliveryMethod).toBe("HOME_DELIVERY");
    expect(order.shippingAmount).toBe(30000n);
    expect(order.userId).not.toBeNull();
    cleanup.push(async () => {
      await prisma.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.emailOutbox.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });

    // Admin can see and cancel the pedido.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto("/admin/orders");
    await page.getByLabel("Buscar").fill(orderCode);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("link", { name: orderCode })).toBeVisible();

    await page.goto(`/admin/orders/${order.id}`);
    await expect(page.getByText("Pendiente de pago")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar pedido" }).click();
    await page.getByPlaceholder("Motivo de cancelación (obligatorio)").fill("prueba e2e");
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByText("Cancelado", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
