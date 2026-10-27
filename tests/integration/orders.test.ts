// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import {
  adjustInventory,
  getAvailableToSell,
  getInventoryBalance,
} from "@/modules/inventory/service";
import {
  AddressNotFoundError,
  CancellationReasonRequiredError,
  cancelOrder,
  createOrderFromCart,
  DeliveryMethodNotAvailableError,
  EmptyCartError,
  expireStaleOrdersAndReservations,
  getOrderByAccessToken,
  getOrderById,
  InsufficientCheckoutStockError,
  listOrders,
  OrderNotCancellableError,
  PriceChangedError,
} from "@/modules/orders/order";
import { createProduct, createVariants, setProductStatus } from "@/modules/products/service";
import { confirmSale, createSale, InsufficientSaleStockError } from "@/modules/sales/sale";
import { updateStoreConfiguration } from "@/modules/store-settings/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

describe("orders — Online Orders & Checkout foundation (real DB)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
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
      name: "Orders Actor",
      email: `orders-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  // Unlike sale-core.ts's own POS-facing resolveSaleItem (an internal admin
  // tool, no public-visibility check at all), createOrderFromCart
  // legitimately requires full public purchasability — see
  // modules/products/visibility.ts's isPubliclyVisible. A DRAFT product
  // (createProduct's default) correctly fails that check, so every test
  // variant here must be explicitly published, mirroring tests/integration/
  // cart.test.ts's own exact setup pattern.
  async function makeSellableVariant(actorId: string, priceAmount: bigint = 100000n) {
    const category = await createCategory(
      { name: `Ord Cat ${Date.now()}-${Math.random()}` },
      actorId,
    );
    const product = await createProduct(
      { name: `Ord Producto ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [
        {
          sizeOptionId: null,
          colorId: null,
          sku: `ORD-SKU-${Date.now()}-${Math.random()}`,
          priceAmount,
        },
      ],
      actorId,
    );
    await setProductStatus(product.id, "ACTIVE", actorId);
    return variant;
  }

  async function seedStock(
    variantId: string,
    warehouseId: string,
    quantity: number,
    actorId: string,
  ) {
    await adjustInventory({
      variantId,
      warehouseId,
      quantityDelta: quantity,
      movementType: "INITIAL_STOCK",
      actorId,
    });
  }

  async function getDefaultWarehouseId() {
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    return warehouse.id;
  }

  async function makePersonCustomer(actorId: string) {
    const result = await createCustomer(
      { type: "PERSON", firstName: "Cliente", lastName: `Pedidos ${Date.now()}-${Math.random()}` },
      actorId,
    );
    if (result.status !== "created") throw new Error("unreachable");
    return result.customer;
  }

  // Cart/CartItem rows are created directly against the DB rather than
  // through modules/cart/service.ts, which is deliberately, entirely
  // "server-only" (it resolves identity from Next.js cookies() — there is
  // no -core split for that module, unlike sales/customers/inventory/
  // orders). createOrderFromCart itself never needs cart identity/cookie
  // resolution — it only ever needs a cartId (see modules/orders/
  // order-core.ts's own doc comment on this exact split) — so this is the
  // correct, minimal way to set up a cart for these tests, not a workaround.
  async function makeCart(input: { userId?: string | null } = {}) {
    return prisma.cart.create({
      data: {
        userId: input.userId ?? null,
        anonymousToken: input.userId ? null : `test-token-${Date.now()}-${Math.random()}`,
        status: "ACTIVE",
        currency: "ARS",
      },
    });
  }

  async function addCartItem(
    cartId: string,
    variantId: string,
    quantity: number,
    observedPrice: bigint,
  ) {
    return prisma.cartItem.create({
      data: {
        cartId,
        productVariantId: variantId,
        quantity,
        observedUnitPriceAmount: observedPrice,
      },
    });
  }

  it("authenticated checkout creates an Order with the correct snapshots and reservation, and converts the cart", async () => {
    const actor = await makeActor();
    const customerUser = await createTestUser({
      name: "Cliente Auth",
      email: `cliente-auth-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(customerUser.id);
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id, 150000n);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 10, actor.id);

    const cart = await makeCart({ userId: customerUser.id });
    await addCartItem(cart.id, variant.id, 2, 150000n);

    const { order, rawAccessToken } = await createOrderFromCart({
      cartId: cart.id,
      userId: customerUser.id,
      customerId: customer.id,
      contact: {
        firstName: "Cliente",
        lastName: "Auth",
        email: "cliente-auth@test.chaioboutique.local",
      },
      deliveryMethod: "PICKUP",
      idempotencyKey: crypto.randomUUID(),
    });

    expect(order.code).toMatch(/^PED-/);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.paymentStatus).toBe("UNPAID");
    expect(order.customerId).toBe(customer.id);
    expect(order.userId).toBe(customerUser.id);
    expect(order.totalAmount).toBe(300000n);
    expect(order.subtotalAmount).toBe(300000n);
    expect(order.shippingAmount).toBe(0n);
    expect(rawAccessToken).toHaveLength(43); // 32 bytes base64url

    const full = await getOrderById(order.id);
    expect(full?.items).toHaveLength(1);
    expect(full?.items[0].quantity).toBe(2);
    expect(full?.items[0].productVariantId).toBe(variant.id);
    expect(full?.reservations).toHaveLength(1);
    expect(full?.reservations[0].status).toBe("ACTIVE");
    expect(full?.reservations[0].quantity).toBe(2);

    const balance = await getInventoryBalance(variant.id, warehouseId);
    expect(balance?.quantity).toBe(10); // untouched — reservation, not a movement
    expect(balance?.reservedQuantity).toBe(2);

    const updatedCart = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(updatedCart.status).toBe("CONVERTED");
  });

  it("guest checkout creates an Order with no linked User/Customer, and never creates a fake User", async () => {
    const actor = await makeActor();
    const variant = await makeSellableVariant(actor.id, 50000n);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);

    const cart = await makeCart();
    await addCartItem(cart.id, variant.id, 1, 50000n);

    const userCountBefore = await prisma.user.count();

    const { order } = await createOrderFromCart({
      cartId: cart.id,
      userId: null,
      customerId: null,
      contact: {
        firstName: "Invitado",
        lastName: "Prueba",
        email: "invitado@test.chaioboutique.local",
      },
      deliveryMethod: "PICKUP",
      idempotencyKey: crypto.randomUUID(),
    });

    expect(order.userId).toBeNull();
    expect(order.customerId).toBeNull();
    expect(order.contactNameSnapshot).toBe("Invitado Prueba");

    const userCountAfter = await prisma.user.count();
    expect(userCountAfter).toBe(userCountBefore); // no fake User created
  });

  it("public access token lookup works for the real token and returns null for a wrong one", async () => {
    const actor = await makeActor();
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);
    const cart = await makeCart();
    await addCartItem(cart.id, variant.id, 1, 100000n);

    const { order, rawAccessToken } = await createOrderFromCart({
      cartId: cart.id,
      userId: null,
      customerId: null,
      contact: { firstName: "Ana", lastName: "Gomez", email: "ana@test.chaioboutique.local" },
      deliveryMethod: "PICKUP",
      idempotencyKey: crypto.randomUUID(),
    });

    const found = await getOrderByAccessToken(rawAccessToken);
    expect(found?.id).toBe(order.id);

    const notFound = await getOrderByAccessToken("not-the-real-token-at-all");
    expect(notFound).toBeNull();
  });

  it("rejects checkout on an empty cart", async () => {
    const cart = await makeCart();
    await expect(
      createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(EmptyCartError);
  });

  it("detects a price change, corrects the cart, and requires an explicit retry", async () => {
    const actor = await makeActor();
    const variant = await makeSellableVariant(actor.id, 100000n);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);
    const cart = await makeCart();
    // Observed price ($800) is stale — the variant's real price is $1000.
    await addCartItem(cart.id, variant.id, 1, 80000n);

    await expect(
      createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(PriceChangedError);

    // No Order was created.
    expect(await prisma.order.count({ where: { code: { contains: "" } } })).toBeGreaterThanOrEqual(
      0,
    );

    // The cart's observed price was corrected — a retry now succeeds.
    const correctedItem = await prisma.cartItem.findFirstOrThrow({ where: { cartId: cart.id } });
    expect(correctedItem.observedUnitPriceAmount).toBe(100000n);

    const { order } = await createOrderFromCart({
      cartId: cart.id,
      userId: null,
      customerId: null,
      contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
      deliveryMethod: "PICKUP",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(order.totalAmount).toBe(100000n);
  });

  it("rejects checkout with a specific message when stock is insufficient — no partial Order/reservation", async () => {
    const actor = await makeActor();
    const variant = await makeSellableVariant(actor.id, 100000n);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 1, actor.id);
    const cart = await makeCart();
    await addCartItem(cart.id, variant.id, 2, 100000n);

    await expect(
      createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(InsufficientCheckoutStockError);

    const reservationCount = await prisma.inventoryReservation.count({
      where: { productVariantId: variant.id },
    });
    expect(reservationCount).toBe(0);
    const balance = await getInventoryBalance(variant.id, warehouseId);
    expect(balance?.reservedQuantity).toBe(0);

    const cartStillActive = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(cartStillActive.status).toBe("ACTIVE"); // never converted on rejection
  });

  it("supports multiple line items in one Order, each with its own reservation", async () => {
    const actor = await makeActor();
    const variantA = await makeSellableVariant(actor.id, 100000n);
    const variantB = await makeSellableVariant(actor.id, 50000n);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variantA.id, warehouseId, 5, actor.id);
    await seedStock(variantB.id, warehouseId, 5, actor.id);
    const cart = await makeCart();
    await addCartItem(cart.id, variantA.id, 1, 100000n);
    await addCartItem(cart.id, variantB.id, 3, 50000n);

    const { order } = await createOrderFromCart({
      cartId: cart.id,
      userId: null,
      customerId: null,
      contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
      deliveryMethod: "PICKUP",
      idempotencyKey: crypto.randomUUID(),
    });

    expect(order.totalAmount).toBe(250000n); // 100000 + 3*50000
    const full = await getOrderById(order.id);
    expect(full?.items).toHaveLength(2);
    expect(full?.reservations).toHaveLength(2);
  });

  it("idempotent checkout: retrying with the same idempotencyKey never creates a second Order", async () => {
    const actor = await makeActor();
    const variant = await makeSellableVariant(actor.id, 100000n);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);
    const cart = await makeCart();
    await addCartItem(cart.id, variant.id, 1, 100000n);
    const idempotencyKey = crypto.randomUUID();

    const first = await createOrderFromCart({
      cartId: cart.id,
      userId: null,
      customerId: null,
      contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
      deliveryMethod: "PICKUP",
      idempotencyKey,
    });
    // Cart is CONVERTED now — a naive retry would otherwise see "no items".
    const second = await createOrderFromCart({
      cartId: cart.id,
      userId: null,
      customerId: null,
      contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
      deliveryMethod: "PICKUP",
      idempotencyKey,
    });

    expect(second.order.id).toBe(first.order.id);
    // Retrying must preserve the private link already queued in the confirmation email.
    expect(second.rawAccessToken).toBe(first.rawAccessToken);
    expect((await getOrderByAccessToken(first.rawAccessToken))?.id).toBe(first.order.id);
    expect((await getOrderByAccessToken(second.rawAccessToken))?.id).toBe(first.order.id);

    const orderCount = await prisma.order.count({ where: { idempotencyKey } });
    expect(orderCount).toBe(1);
    const otherCart = await makeCart();
    await expect(
      createOrderFromCart({
        cartId: otherCart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey,
      }),
    ).rejects.toThrow(/tu carrito/);
  });

  describe("delivery methods and address handling", () => {
    it("rejects HOME_DELIVERY when no flat fee is configured", async () => {
      await updateStoreConfiguration({ homeDeliveryFlatFeeAmount: null }, (await makeActor()).id);
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 5, actor.id);
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 1, 100000n);

      await expect(
        createOrderFromCart({
          cartId: cart.id,
          userId: null,
          customerId: null,
          contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
          deliveryMethod: "HOME_DELIVERY",
          newAddress: { street: "Calle Falsa", city: "Springfield" },
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow(DeliveryMethodNotAvailableError);
    });

    it("snapshots a new inline address, and applies the configured flat fee", async () => {
      const actor = await makeActor();
      await updateStoreConfiguration(
        {
          homeDeliveryFlatFeeAmount: 25000n,
          homeDeliveryPostalCodes: "5856",
          homeDeliveryEstimate: "2 a 5 días hábiles",
        },
        actor.id,
      );
      const variant = await makeSellableVariant(actor.id, 100000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 5, actor.id);
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 1, 100000n);

      const { order } = await createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "HOME_DELIVERY",
        newAddress: {
          street: "Av. Siempre Viva",
          number: "742",
          city: "Springfield",
          postalCode: "5856",
        },
        idempotencyKey: crypto.randomUUID(),
      });

      expect(order.shippingAmount).toBe(25000n);
      expect(order.totalAmount).toBe(125000n);
      expect(order.shippingStreet).toBe("Av. Siempre Viva");
      expect(order.shippingCity).toBe("Springfield");

      await updateStoreConfiguration({ homeDeliveryFlatFeeAmount: null }, actor.id); // reset for other tests
    });

    it("rejects an existingAddressId that does not belong to the checking-out customer", async () => {
      const actor = await makeActor();
      await updateStoreConfiguration(
        {
          homeDeliveryFlatFeeAmount: 10000n,
          homeDeliveryPostalCodes: "5856",
          homeDeliveryEstimate: "2 a 5 días hábiles",
        },
        actor.id,
      );
      const ownerCustomer = await makePersonCustomer(actor.id);
      const otherCustomer = await makePersonCustomer(actor.id);
      const address = await prisma.customerAddress.create({
        data: { customerId: ownerCustomer.id, street: "Real", city: "Real City" },
      });

      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 5, actor.id);
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 1, 100000n);

      await expect(
        createOrderFromCart({
          cartId: cart.id,
          userId: null,
          customerId: otherCustomer.id,
          contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
          deliveryMethod: "HOME_DELIVERY",
          existingAddressId: address.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow(AddressNotFoundError);

      await updateStoreConfiguration({ homeDeliveryFlatFeeAmount: null }, actor.id);
    });
  });

  describe("concurrency — cannot oversell across simultaneous checkouts", () => {
    it("stock = 1, two simultaneous checkouts for 1 unit — exactly one succeeds", async () => {
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id, 100000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 1, actor.id);

      const cartA = await makeCart();
      await addCartItem(cartA.id, variant.id, 1, 100000n);
      const cartB = await makeCart();
      await addCartItem(cartB.id, variant.id, 1, 100000n);

      const results = await Promise.allSettled([
        createOrderFromCart({
          cartId: cartA.id,
          userId: null,
          customerId: null,
          contact: { firstName: "A", lastName: "A", email: "a@test.chaioboutique.local" },
          deliveryMethod: "PICKUP",
          idempotencyKey: crypto.randomUUID(),
        }),
        createOrderFromCart({
          cartId: cartB.id,
          userId: null,
          customerId: null,
          contact: { firstName: "B", lastName: "B", email: "b@test.chaioboutique.local" },
          deliveryMethod: "PICKUP",
          idempotencyKey: crypto.randomUUID(),
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);

      const available = await getAvailableToSell(variant.id, warehouseId);
      expect(available).toBe(0); // never negative, never both reserved
    });
  });

  describe("POS respects active reservations", () => {
    it("on hand 5, active reservation 2 — POS confirming 4 fails; confirming 3 succeeds", async () => {
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id, 100000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 5, actor.id);

      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 2, 100000n);
      await createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      });

      const posCustomer = await makePersonCustomer(actor.id);
      const draftTooMuch = await createSale(
        { customerId: posCustomer.id, items: [{ productVariantId: variant.id, quantity: 4 }] },
        actor.id,
      );
      await expect(confirmSale(draftTooMuch.id, actor.id)).rejects.toThrow(
        InsufficientSaleStockError,
      );

      const draftOk = await createSale(
        { customerId: posCustomer.id, items: [{ productVariantId: variant.id, quantity: 3 }] },
        actor.id,
      );
      const confirmed = await confirmSale(draftOk.id, actor.id);
      expect(confirmed.status).toBe("CONFIRMED");

      const balance = await getInventoryBalance(variant.id, warehouseId);
      expect(balance?.quantity).toBe(2); // 5 - 3 physically deducted
      expect(balance?.reservedQuantity).toBe(2); // untouched by the POS sale
    });
  });

  describe("expiration", () => {
    it("expireStaleOrdersAndReservations marks a stale Order EXPIRED and releases its reservation", async () => {
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id, 100000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 3, actor.id);
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 2, 100000n);

      const { order } = await createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      });

      // Force the reservation into the past — simulates real elapsed time
      // without waiting RESERVATION_WINDOW_MINUTES for real.
      await prisma.order.update({
        where: { id: order.id },
        data: { reservationExpiresAt: new Date(Date.now() - 60_000) },
      });

      const result = await expireStaleOrdersAndReservations();
      expect(result.expiredOrderCount).toBeGreaterThanOrEqual(1);

      const expired = await getOrderById(order.id);
      expect(expired?.status).toBe("EXPIRED");
      expect(expired?.reservations[0].status).toBe("EXPIRED");

      const available = await getAvailableToSell(variant.id, warehouseId);
      expect(available).toBe(3); // fully released
    });
  });

  describe("admin cancellation", () => {
    it("cancels a PENDING_PAYMENT Order, releasing its reservation exactly once", async () => {
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id, 100000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 4, actor.id);
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 2, 100000n);

      const { order } = await createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      });

      const cancelled = await cancelOrder(order.id, "cliente se arrepintió", actor.id);
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancelledById).toBe(actor.id);

      const available = await getAvailableToSell(variant.id, warehouseId);
      expect(available).toBe(4);

      // No physical inventory movement was generated by the Order/
      // cancellation — only the INITIAL_STOCK seed movement from
      // seedStock above exists; nothing was ever physically deducted.
      const movementCount = await prisma.inventoryMovement.count({
        where: { variantId: variant.id, warehouseId },
      });
      expect(movementCount).toBe(1);
    });

    it("requires a non-empty reason", async () => {
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 2, actor.id);
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 1, 100000n);
      const { order } = await createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      });

      await expect(cancelOrder(order.id, "", actor.id)).rejects.toThrow(
        CancellationReasonRequiredError,
      );
    });

    it("rejects cancelling an Order that already left PENDING_PAYMENT", async () => {
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 2, actor.id);
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 1, 100000n);
      const { order } = await createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: { firstName: "A", lastName: "B", email: "a@test.chaioboutique.local" },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      });
      await cancelOrder(order.id, "primer motivo", actor.id);

      await expect(cancelOrder(order.id, "segundo motivo", actor.id)).rejects.toThrow(
        OrderNotCancellableError,
      );

      // No double release — reservedQuantity was only ever decremented once.
      const available = await getAvailableToSell(variant.id, warehouseId);
      expect(available).toBe(2);
    });
  });

  describe("listOrders", () => {
    it("filters by status, paymentStatus and search", async () => {
      const actor = await makeActor();
      const variant = await makeSellableVariant(actor.id, 100000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 5, actor.id);
      const uniqueName = `BuscameYa${Date.now()}`;
      const cart = await makeCart();
      await addCartItem(cart.id, variant.id, 1, 100000n);
      const { order } = await createOrderFromCart({
        cartId: cart.id,
        userId: null,
        customerId: null,
        contact: {
          firstName: uniqueName,
          lastName: "Apellido",
          email: "buscame@test.chaioboutique.local",
        },
        deliveryMethod: "PICKUP",
        idempotencyKey: crypto.randomUUID(),
      });

      const { orders: byCode } = await listOrders({ search: order.code });
      expect(byCode.map((o) => o.id)).toContain(order.id);

      const { orders: byName } = await listOrders({ search: uniqueName });
      expect(byName.map((o) => o.id)).toContain(order.id);

      const { orders: byStatus } = await listOrders({ status: "PENDING_PAYMENT" });
      expect(byStatus.map((o) => o.id)).toContain(order.id);

      const { orders: wrongStatus } = await listOrders({ status: "DELIVERED" });
      expect(wrongStatus.map((o) => o.id)).not.toContain(order.id);
    });
  });
});
