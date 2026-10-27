// @vitest-environment node
import "./guard";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import {
  adjustInventory,
  getAvailableToSell,
  getInventoryBalance,
} from "@/modules/inventory/service";
import { createOrderFromCart, expireStaleOrdersAndReservations } from "@/modules/orders/order";
import {
  getMercadoPagoClient,
  setMercadoPagoClientForTesting,
} from "@/modules/payments/mercado-pago/client-core";
import { setMercadoPagoConfigForTesting } from "@/modules/payments/mercado-pago/config-core";
import {
  FakeMercadoPagoClient,
  getFakePreference,
  resetFakeMercadoPagoStore,
  simulateMercadoPagoPayment,
} from "@/modules/payments/mercado-pago/fake-client-core";
import {
  createMercadoPagoPreference,
  OrderNotPayableError,
  OrderRequiresReviewError,
} from "@/modules/payments/mercado-pago/preference-core";
import { reconcileMercadoPagoPayment } from "@/modules/payments/mercado-pago/reconcile-core";
import { recordProviderAdjustment } from "@/modules/payments/mercado-pago/adjustments-core";
import { updateOrderFulfillment } from "@/modules/orders/fulfillment-core";
import { requestOrderRecovery } from "@/modules/orders/recovery-core";
import { getSalesReportSummary } from "@/modules/sales/report-core";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service";

// Uses FakeMercadoPagoClient exclusively — see this integration's explicit
// "automated tests must not require internet or Mercado Pago credentials"
// requirement. No test here ever calls RealMercadoPagoClient. Also injects a
// fake CONFIG (setMercadoPagoConfigForTesting) — createMercadoPagoPreference
// calls getMercadoPagoConfig() independently of the client, so faking only
// the client left this whole suite failing closed with
// MercadoPagoNotConfiguredError against a real developer's blank .env; see
// config-core.ts's own comment for the root cause (globalSetup's old
// process.env mutation ran in the wrong process and never took effect).
describe("Mercado Pago Checkout Pro integration (real DB)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  beforeEach(() => {
    setMercadoPagoClientForTesting(new FakeMercadoPagoClient());
    setMercadoPagoConfigForTesting({
      accessToken: "TEST-integration-test-fake-token",
      webhookSecret: "integration-test-fake-webhook-secret",
      environment: "TEST",
      publicBaseUrl: "http://localhost:3000",
    });
  });

  afterEach(async () => {
    setMercadoPagoClientForTesting(null);
    setMercadoPagoConfigForTesting(null);
    resetFakeMercadoPagoStore();
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function makeActor() {
    const actor = await createTestUser({
      name: "MP Actor",
      email: `mp-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  async function makeSellableVariant(actorId: string, priceAmount: bigint) {
    const category = await createCategory(
      { name: `MP Cat ${Date.now()}-${Math.random()}` },
      actorId,
    );
    const product = await createProduct(
      { name: `MP Producto ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [
        {
          sizeOptionId: null,
          colorId: null,
          sku: `MP-SKU-${Date.now()}-${Math.random()}`,
          priceAmount,
        },
      ],
      actorId,
    );
    await setProductStatus(product.id, "ACTIVE", actorId);
    return variant;
  }

  async function getDefaultWarehouseId() {
    const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    return warehouse.id;
  }

  async function makeCart() {
    return prisma.cart.create({
      data: {
        userId: null,
        anonymousToken: `mp-test-token-${Date.now()}-${Math.random()}`,
        status: "ACTIVE",
        currency: "ARS",
      },
    });
  }

  interface PayableOrderOptions {
    quantity?: number;
    priceAmount?: bigint;
    stock?: number;
    userId?: string | null;
    customerId?: string | null;
    email?: string;
  }

  async function makePayableOrder(actorId: string, opts: PayableOrderOptions = {}) {
    const priceAmount = opts.priceAmount ?? 100000n;
    const quantity = opts.quantity ?? 2;
    const stock = opts.stock ?? 10;
    const variant = await makeSellableVariant(actorId, priceAmount);
    const warehouseId = await getDefaultWarehouseId();
    await adjustInventory({
      variantId: variant.id,
      warehouseId,
      quantityDelta: stock,
      movementType: "INITIAL_STOCK",
      actorId,
    });

    const cart = await makeCart();
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productVariantId: variant.id,
        quantity,
        observedUnitPriceAmount: priceAmount,
      },
    });

    const email = opts.email ?? `mp-guest-${Date.now()}-${Math.random()}@test.chaioboutique.local`;
    const { order, rawAccessToken } = await createOrderFromCart({
      cartId: cart.id,
      userId: opts.userId ?? null,
      customerId: opts.customerId ?? null,
      contact: { firstName: "Cliente", lastName: `MP ${Date.now()}`, email },
      deliveryMethod: "PICKUP",
      idempotencyKey: crypto.randomUUID(),
    });

    return { order, rawAccessToken, variant, warehouseId };
  }

  async function makePreference(orderId: string, orderToken: string) {
    const result = await createMercadoPagoPreference({
      orderId,
      orderToken,
      idempotencyKey: crypto.randomUUID(),
    });
    const preferenceId = new URL(result.checkoutUrl, "http://localhost").searchParams.get(
      "preferenceId",
    );
    if (!preferenceId) throw new Error("unreachable: fake checkoutUrl always carries preferenceId");
    return { checkoutUrl: result.checkoutUrl, preferenceId };
  }

  // ===========================================================================
  // A — Preference creation
  // ===========================================================================
  it("creates a preference for a valid pending Order and persists the provider preference id", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);

    const { checkoutUrl, preferenceId } = await makePreference(order.id, rawAccessToken);

    expect(checkoutUrl).toContain("/api/e2e-mercado-pago/checkout");
    const attempt = await prisma.orderPaymentAttempt.findFirst({ where: { orderId: order.id } });
    expect(attempt?.providerPreferenceId).toBe(preferenceId);
    expect(attempt?.status).toBe("CREATED");
    expect(attempt?.checkoutUrl).toBe(checkoutUrl);
    expect(attempt?.amount).toBe(order.totalAmount);
    expect(attempt?.currency).toBe(order.currency);
    expect(getFakePreference(preferenceId)?.externalReference).toBe(order.id);
  });

  it("reuses an existing non-terminal preference instead of creating a duplicate on a fresh click", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);

    const first = await makePreference(order.id, rawAccessToken);
    const second = await createMercadoPagoPreference({
      orderId: order.id,
      orderToken: rawAccessToken,
      idempotencyKey: crypto.randomUUID(),
    });

    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    const attempts = await prisma.orderPaymentAttempt.count({ where: { orderId: order.id } });
    expect(attempts).toBe(1);
  });

  it("a literal retry with the SAME idempotencyKey returns the exact same attempt, never a second preference", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const key = crypto.randomUUID();

    const first = await createMercadoPagoPreference({
      orderId: order.id,
      orderToken: rawAccessToken,
      idempotencyKey: key,
    });
    const second = await createMercadoPagoPreference({
      orderId: order.id,
      orderToken: rawAccessToken,
      idempotencyKey: key,
    });

    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    const attempts = await prisma.orderPaymentAttempt.count({ where: { orderId: order.id } });
    expect(attempts).toBe(1);
  });

  // ===========================================================================
  // B — Expired Order
  // ===========================================================================
  it("refuses to create a preference for an expired Order, and expires it first if it was only just stale", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);

    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      createMercadoPagoPreference({
        orderId: order.id,
        orderToken: rawAccessToken,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(OrderNotPayableError);

    const attemptCount = await prisma.orderPaymentAttempt.count({ where: { orderId: order.id } });
    expect(attemptCount).toBe(0);
    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("EXPIRED");
  });

  // ===========================================================================
  // C — Webhook approved: full finalization + exact inventory invariant
  // ===========================================================================
  it("reconciling an approved payment finalizes the Order atomically: Sale, SaleItem, SalePayment, stock consumed exactly once, reservation CONSUMED, Order PAID", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken, variant, warehouseId } = await makePayableOrder(actor.id, {
      quantity: 2,
      priceAmount: 100000n,
      stock: 10,
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);

    const balanceBefore = await getInventoryBalance(variant.id, warehouseId);
    expect(balanceBefore?.quantity).toBe(10);
    expect(balanceBefore?.reservedQuantity).toBe(2);

    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("approved_finalized");

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe("PAID");
    expect(finalOrder.paymentStatus).toBe("PAID");
    expect(finalOrder.reservationExpiresAt).toBeNull();

    const sale = await prisma.sale.findUnique({
      where: { orderId: order.id },
      include: { items: true, payments: true },
    });
    expect(sale).not.toBeNull();
    expect(sale?.status).toBe("CONFIRMED");
    expect(sale?.totalAmount).toBe(order.totalAmount);
    expect(sale?.paymentStatus).toBe("PAID");
    expect(sale?.paidAmount).toBe(order.totalAmount);
    expect(sale?.items).toHaveLength(1);
    expect(sale?.items[0].quantity).toBe(2);
    expect(sale?.items[0].productVariantId).toBe(variant.id);
    expect(sale?.payments).toHaveLength(1);
    expect(sale?.payments[0].method).toBe("MERCADO_PAGO");
    expect(sale?.payments[0].amount).toBe(order.totalAmount);
    expect(sale?.payments[0].reference).toBe(paymentId);

    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: order.id },
    });
    expect(reservation?.status).toBe("CONSUMED");

    // The EXACT worked example from this integration's spec: before
    // onHand=10 reserved=2 available=8; after onHand=8 reserved=0
    // available=8 — never onHand=8/reserved=2 (double-count), never
    // onHand=6 (double-deduct).
    const balanceAfter = await getInventoryBalance(variant.id, warehouseId);
    expect(balanceAfter?.quantity).toBe(8);
    expect(balanceAfter?.reservedQuantity).toBe(0);
    expect(await getAvailableToSell(variant.id, warehouseId)).toBe(8);

    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: variant.id, warehouseId, movementType: "SALE" },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].quantityDelta).toBe(-2);
  });

  // Phase — ARCA Fiscal Readiness correction pass (item 4/12): an online
  // checkout finalized through Mercado Pago must snapshot the resulting
  // SaleItem's tax category exactly like a POS sale does — this was a real
  // gap this correction pass closed (finalizePaidOrderTransactionally
  // builds SaleItem rows independently of modules/sales/sale-core.ts's
  // resolveSaleItem, so it needed the identical resolveSaleItemTaxSnapshot
  // call wired in separately).
  it("finalizing a Mercado Pago payment snapshots the Product's tax category onto the resulting SaleItem", async () => {
    const actor = await makeActor();
    const category = await createCategory(
      { name: `MP Tax Cat ${Date.now()}-${Math.random()}` },
      actor.id,
    );
    const product = await createProduct(
      {
        name: `MP Tax Producto ${Date.now()}-${Math.random()}`,
        categoryId: category.id,
        taxCategory: "IVA_10_5",
      },
      actor.id,
    );
    const [variant] = await createVariants(
      product.id,
      [
        {
          sizeOptionId: null,
          colorId: null,
          sku: `MP-TAX-SKU-${Date.now()}-${Math.random()}`,
          priceAmount: 50000n,
        },
      ],
      actor.id,
    );
    await setProductStatus(product.id, "ACTIVE", actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await adjustInventory({
      variantId: variant.id,
      warehouseId,
      quantityDelta: 5,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    const cart = await makeCart();
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productVariantId: variant.id,
        quantity: 1,
        observedUnitPriceAmount: 50000n,
      },
    });
    const { order, rawAccessToken } = await createOrderFromCart({
      cartId: cart.id,
      userId: null,
      customerId: null,
      contact: {
        firstName: "Cliente",
        lastName: `MP Tax ${Date.now()}`,
        email: `mp-tax-guest-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      },
      deliveryMethod: "PICKUP",
      idempotencyKey: crypto.randomUUID(),
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("approved_finalized");

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { orderId: order.id },
      include: { items: true },
    });
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].taxCategory).toBe("IVA_10_5");
    expect(sale.items[0].taxRateBasisPoints).toBe(1050);
  });

  // ===========================================================================
  // D/E — Webhook idempotency and concurrency
  // ===========================================================================
  it("processing the same approved payment id twice produces exactly one Sale, one stock deduction, one SalePayment", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken, variant, warehouseId } = await makePayableOrder(actor.id, {
      quantity: 2,
      stock: 10,
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");

    const first = await reconcileMercadoPagoPayment(paymentId);
    const second = await reconcileMercadoPagoPayment(paymentId);

    expect(first.outcome).toBe("approved_finalized");
    expect(second.outcome).toBe("already_finalized");

    const sales = await prisma.sale.findMany({ where: { orderId: order.id } });
    expect(sales).toHaveLength(1);
    const payments = await prisma.salePayment.findMany({ where: { saleId: sales[0].id } });
    expect(payments).toHaveLength(1);
    const balance = await getInventoryBalance(variant.id, warehouseId);
    expect(balance?.quantity).toBe(8);
  });

  it("two concurrent reconcile calls for the same approved payment produce exactly one Sale (real DB row-lock serialization)", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken, variant, warehouseId } = await makePayableOrder(actor.id, {
      quantity: 2,
      stock: 10,
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");

    const [a, b] = await Promise.all([
      reconcileMercadoPagoPayment(paymentId),
      reconcileMercadoPagoPayment(paymentId),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["already_finalized", "approved_finalized"]);

    const sales = await prisma.sale.findMany({ where: { orderId: order.id } });
    expect(sales).toHaveLength(1);
    const balance = await getInventoryBalance(variant.id, warehouseId);
    expect(balance?.quantity).toBe(8);
  });

  // ===========================================================================
  // F/G — Pending and rejected payments
  // ===========================================================================
  it("a pending payment leaves the Order PENDING_PAYMENT with its reservation still ACTIVE", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "pending");

    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("pending");

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("PENDING_PAYMENT");
    expect(refreshed.paymentStatus).toBe("UNPAID");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { orderId: order.id },
    });
    expect(reservation?.status).toBe("ACTIVE");
  });

  it("a rejected payment leaves the Order payable — a new preference can still be created while the reservation is valid", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "rejected");

    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("rejected");

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("PENDING_PAYMENT");

    const retry = await createMercadoPagoPreference({
      orderId: order.id,
      orderToken: rawAccessToken,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(retry.checkoutUrl).toBeTruthy();
    const attempts = await prisma.orderPaymentAttempt.count({ where: { orderId: order.id } });
    expect(attempts).toBe(2);
  });

  // ===========================================================================
  // H/I — Amount and currency mismatch
  // ===========================================================================
  it("an amount mismatch never creates a Sale and flags the Order for admin review", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id, {
      quantity: 2,
      priceAmount: 100000n,
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved", { amount: 999999n });

    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("requires_review");

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).not.toBe("PAID");
    expect(refreshed.requiresPaymentReview).toBe(true);
    expect(refreshed.paymentReviewReason).toBeTruthy();
    expect(await prisma.sale.count({ where: { orderId: order.id } })).toBe(0);

    const attempt = await prisma.orderPaymentAttempt.findFirst({ where: { orderId: order.id } });
    expect(attempt?.status).toBe("FAILED_RECONCILIATION");
    expect(attempt?.failureCode).toBe("AMOUNT_MISMATCH");
  });

  it("a currency mismatch never creates a Sale and flags the Order for admin review", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved", { currency: "USD" });

    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("requires_review");

    expect(await prisma.sale.count({ where: { orderId: order.id } })).toBe(0);
    const attempt = await prisma.orderPaymentAttempt.findFirst({ where: { orderId: order.id } });
    expect(attempt?.failureCode).toBe("CURRENCY_MISMATCH");
  });

  // ===========================================================================
  // J/K — Late payment policy
  // ===========================================================================
  it("an approved payment arriving after the reservation expired still finalizes when enough stock remains (controlled re-acquisition)", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken, variant, warehouseId } = await makePayableOrder(actor.id, {
      quantity: 2,
      stock: 10,
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);

    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });
    await expireStaleOrdersAndReservations();

    const expired = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(expired.status).toBe("EXPIRED");
    const reservationAfterExpiry = await prisma.inventoryReservation.findFirst({
      where: { orderId: order.id },
    });
    expect(reservationAfterExpiry?.status).toBe("EXPIRED");
    const balanceAfterExpiry = await getInventoryBalance(variant.id, warehouseId);
    expect(balanceAfterExpiry?.reservedQuantity).toBe(0);

    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("approved_finalized");

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe("PAID");
    const sale = await prisma.sale.findUnique({ where: { orderId: order.id } });
    expect(sale?.status).toBe("CONFIRMED");
    const balanceAfter = await getInventoryBalance(variant.id, warehouseId);
    expect(balanceAfter?.quantity).toBe(8);
  });

  it("an approved payment arriving after expiry, with insufficient current stock, never oversells and flags for review", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken, variant, warehouseId } = await makePayableOrder(actor.id, {
      quantity: 2,
      stock: 2,
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);

    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });
    await expireStaleOrdersAndReservations();

    // Someone else took the stock that got released back.
    await adjustInventory({
      variantId: variant.id,
      warehouseId,
      quantityDelta: -2,
      movementType: "ADJUSTMENT_OUT",
      actorId: actor.id,
      reason: "otro cliente",
    });
    const balanceBefore = await getInventoryBalance(variant.id, warehouseId);
    expect(balanceBefore?.quantity).toBe(0);

    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    const result = await reconcileMercadoPagoPayment(paymentId);
    expect(result.outcome).toBe("requires_review");

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe("EXPIRED");
    expect(finalOrder.requiresPaymentReview).toBe(true);
    expect(await prisma.sale.count({ where: { orderId: order.id } })).toBe(0);

    const balanceAfter = await getInventoryBalance(variant.id, warehouseId);
    expect(balanceAfter?.quantity).toBe(0);
    expect(balanceAfter!.quantity).toBeGreaterThanOrEqual(0);

    const attempt = await prisma.orderPaymentAttempt.findFirst({ where: { orderId: order.id } });
    expect(attempt?.failureCode).toBe("INSUFFICIENT_STOCK");
  });

  // ===========================================================================
  // M — Paid Order revisit
  // ===========================================================================
  it("refuses to create a new preference for an already-PAID Order", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    await reconcileMercadoPagoPayment(paymentId);

    await expect(
      createMercadoPagoPreference({
        orderId: order.id,
        orderToken: rawAccessToken,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(OrderNotPayableError);
  });

  it("refuses to create a new preference for an Order that requires payment review", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved", { amount: 1n });
    await reconcileMercadoPagoPayment(paymentId);

    await expect(
      createMercadoPagoPreference({
        orderId: order.id,
        orderToken: rawAccessToken,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(OrderRequiresReviewError);
  });

  // ===========================================================================
  // N — Guest/authenticated customer resolution
  // ===========================================================================
  it("finalizing an authenticated Order's payment reuses the Order's own linked Customer, never Consumidor Final", async () => {
    const actor = await makeActor();
    const customerUser = await createTestUser({
      name: "Cliente Auth MP",
      email: `mp-auth-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(customerUser.id);
    const customerResult = await createCustomer(
      { type: "PERSON", firstName: "Cliente", lastName: `Auth MP ${Date.now()}` },
      actor.id,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");

    const { order, rawAccessToken } = await makePayableOrder(actor.id, {
      userId: customerUser.id,
      customerId: customerResult.customer.id,
    });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    await reconcileMercadoPagoPayment(paymentId);

    const sale = await prisma.sale.findUnique({ where: { orderId: order.id } });
    expect(sale?.customerId).toBe(customerResult.customer.id);
  });

  it("finalizing a guest Order with no existing customer match auto-creates a real Customer from the contact snapshot", async () => {
    const actor = await makeActor();
    const email = `mp-new-guest-${Date.now()}-${Math.random()}@test.chaioboutique.local`;
    const { order, rawAccessToken } = await makePayableOrder(actor.id, { email });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    await reconcileMercadoPagoPayment(paymentId);

    const sale = await prisma.sale.findUnique({
      where: { orderId: order.id },
      include: { customer: true },
    });
    expect(sale?.customer.isSystemDefault).toBe(false);
    expect(sale?.customer.email).toBe(email);
    expect(sale?.customerNameSnapshot).toBe(order.contactNameSnapshot);
  });

  it("finalizing a guest Order whose contact matches an existing Customer falls back to Consumidor Final, never auto-merging, but keeps the real guest name on the Sale", async () => {
    const actor = await makeActor();
    const email = `mp-existing-match-${Date.now()}@test.chaioboutique.local`;
    const existingResult = await createCustomer(
      { type: "PERSON", firstName: "Ya", lastName: "Existe", email },
      actor.id,
    );
    if (existingResult.status !== "created") throw new Error("unreachable");

    const { order, rawAccessToken } = await makePayableOrder(actor.id, { email });
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    await reconcileMercadoPagoPayment(paymentId);

    const sale = await prisma.sale.findUnique({
      where: { orderId: order.id },
      include: { customer: true },
    });
    expect(sale?.customer.isSystemDefault).toBe(true);
    expect(sale?.customerId).not.toBe(existingResult.customer.id);
    expect(sale?.customerNameSnapshot).toBe(order.contactNameSnapshot);
  });

  // ===========================================================================
  // Provider selection sanity check
  // ===========================================================================
  it("getMercadoPagoClient returns the injected fake, never the real client, during this suite", () => {
    expect(getMercadoPagoClient()).toBeInstanceOf(FakeMercadoPagoClient);
  });
  it("records a partial refund after approval exactly once, keeps net payments, and never restores physical stock", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken, variant, warehouseId } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    await reconcileMercadoPagoPayment(paymentId);
    const payment = (await getMercadoPagoClient().getPayment(paymentId))!;
    const stock = await getInventoryBalance(variant.id, warehouseId);
    const adjustment = { ...payment, refundedAmount: 40000n };
    setMercadoPagoClientForTesting({
      createPreference: async () => {
        throw new Error("unused");
      },
      getPayment: async () => adjustment,
    });
    expect((await reconcileMercadoPagoPayment(paymentId)).outcome).toBe("refunded");
    await Promise.all([
      recordProviderAdjustment(order.id, adjustment),
      recordProviderAdjustment(order.id, adjustment),
    ]);
    expect(await prisma.providerPaymentAdjustment.count({ where: { orderId: order.id } })).toBe(1);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(sale.paidAmount).toBe(order.totalAmount - 40000n);
    expect(sale.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(await getInventoryBalance(variant.id, warehouseId)).toEqual(stock);
    await expect(
      updateOrderFulfillment({ orderId: order.id, status: "PROCESSING" }, actor.id),
    ).rejects.toThrow(/Revisá el pago/);
    await recordProviderAdjustment(order.id, { ...payment, status: "refunded" });
    const full = await prisma.sale.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(full.paidAmount).toBe(0n);
    expect(full.refundedAmount).toBe(order.totalAmount);
    expect(full.paymentStatus).toBe("REFUNDED");
    const report = await getSalesReportSummary({ saleCodeSearch: full.code });
    expect(report.totalCollectedAmount).toBe(0n);
    expect(report.totalPendingAmount).toBe(0n);
    expect(await getInventoryBalance(variant.id, warehouseId)).toEqual(stock);
  });

  it("tracks a chargeback and rejects a reversal belonging to another payment", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    await reconcileMercadoPagoPayment(paymentId);
    const payment = (await getMercadoPagoClient().getPayment(paymentId))!;
    await recordProviderAdjustment(order.id, {
      ...payment,
      id: "unbound-payment",
      status: "refunded",
    });
    expect(await prisma.providerPaymentAdjustment.count({ where: { orderId: order.id } })).toBe(0);
    await recordProviderAdjustment(order.id, { ...payment, status: "charged_back" });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(sale.paymentStatus).toBe("CHARGED_BACK");
    expect(sale.chargebackAmount).toBe(order.totalAmount);
    expect(sale.paidAmount).toBe(0n);
  });

  it("progresses pickup fulfillment with emails and recovers the same private link only to the buyer email", async () => {
    const actor = await makeActor();
    const { order, rawAccessToken } = await makePayableOrder(actor.id);
    const { preferenceId } = await makePreference(order.id, rawAccessToken);
    const { paymentId } = simulateMercadoPagoPayment(preferenceId, "approved");
    await reconcileMercadoPagoPayment(paymentId);
    await updateOrderFulfillment({ orderId: order.id, status: "PROCESSING" }, actor.id);
    await expect(
      updateOrderFulfillment({ orderId: order.id, status: "SHIPPED" }, actor.id),
    ).rejects.toThrow(/retirar/);
    await updateOrderFulfillment({ orderId: order.id, status: "READY_FOR_PICKUP" }, actor.id);
    await updateOrderFulfillment({ orderId: order.id, status: "DELIVERED" }, actor.id);
    const requestId = crypto.randomUUID();
    await requestOrderRecovery({
      requestId,
      orderCode: order.code,
      email: "wrong@test.chaioboutique.local",
    });
    expect(
      await prisma.emailOutbox.count({
        where: { eventKey: `order-recovery:${order.id}:${requestId}` },
      }),
    ).toBe(0);
    await requestOrderRecovery({
      requestId,
      orderCode: order.code,
      email: order.contactEmailSnapshot,
    });
    expect(
      await prisma.emailOutbox.count({
        where: { eventKey: `order-recovery:${order.id}:${requestId}` },
      }),
    ).toBe(1);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("DELIVERED");
    expect(updated.deliveredAt).not.toBeNull();
    expect(await prisma.sale.count({ where: { orderId: order.id } })).toBe(1);
  });
});
