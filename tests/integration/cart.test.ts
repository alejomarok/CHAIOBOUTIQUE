// @vitest-environment node
import "./guard";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The auth boundary is mocked, deliberately — cart tests exercise real cart
// persistence/business logic against a real database; session-to-user
// resolution itself is already covered thoroughly elsewhere (rbac.test.ts,
// customer-registration.test.ts). `currentUser` controls what
// getCurrentUser() reports; `fakeCookies` is a minimal in-memory stand-in
// for next/headers' cookies() (which requires a real Next.js request
// context this plain Vitest test never has).
let currentUser: { id: string; roles: string[] } | null = null;
vi.mock("@/modules/auth", () => ({
  getCurrentUser: async () => currentUser,
}));

class FakeCookieStore {
  private store = new Map<string, string>();
  get(name: string) {
    const value = this.store.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string) {
    this.store.set(name, value);
  }
  delete(name: string) {
    this.store.delete(name);
  }
  reset() {
    this.store.clear();
  }
}
const fakeCookies = new FakeCookieStore();
vi.mock("next/headers", () => ({
  cookies: async () => fakeCookies,
  headers: async () => new Headers(),
}));

const { prisma } = await import("@/lib/db");
const { createTestUser, deleteTestUser } = await import("../fixtures/users");
const { createCategory } = await import("@/modules/categories/service");
const { createProduct, createVariants, setProductStatus, updateProduct } = await import(
  "@/modules/products/service"
);
const { createWarehouse, setDefaultWarehouse } = await import("@/modules/warehouses/service");
const { adjustInventory } = await import("@/modules/inventory/service");
const cartService = await import("@/modules/cart/service");

describe("cart service (real DB)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  beforeEach(() => {
    currentUser = null;
    fakeCookies.reset();
  });

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

  // Category/product/variant are deliberately never torn down by this
  // helper's own cleanup — the same reasoning as tests/e2e/catalog.spec.ts's
  // "an ACTIVE product with stock" test: once a real inventory movement
  // (adjustInventory below) or a CartItem references the variant, both
  // Category → Product → ProductVariant (all onDelete: Restrict) AND
  // ProductVariant ← CartItem/InventoryMovement (also Restrict) make
  // deletion impossible regardless of ordering. Left for the integration
  // suite's own full-database reset (tests/integration/reset-db.ts), same
  // as the ADMIN/CUSTOMER fixture users below.
  async function setupPurchasableProduct(
    options: { stock?: number; priceAmount?: bigint } = {},
  ) {
    const actor = await createTestUser({
      name: "Cart Test Actor",
      email: `cart-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Cart Categoria ${Date.now()}` }, actor.id);

    const product = await createProduct(
      {
        name: `Cart Producto ${Date.now()}-${Math.random()}`,
        categoryId: category.id,
        defaultPriceAmount: options.priceAmount ?? 1000n,
      },
      actor.id,
    );

    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `CART-SKU-${Date.now()}-${Math.random()}` }],
      actor.id,
    );

    await setProductStatus(product.id, "ACTIVE", actor.id);

    if (options.stock !== undefined) {
      const existingDefault = await prisma.warehouse.findFirst({ where: { isDefault: true } });
      let warehouseId = existingDefault?.id;
      if (!warehouseId) {
        const created = await createWarehouse(
          { code: `CART-WH-${Date.now()}`, name: "Depósito Cart Test" },
          actor.id,
        );
        warehouseId = created.id;
        await setDefaultWarehouse(created.id, actor.id);
      }
      if (options.stock > 0) {
        await adjustInventory({
          variantId: variant.id,
          warehouseId,
          quantityDelta: options.stock,
          movementType: "INITIAL_STOCK",
          actorId: actor.id,
        });
      }
    }

    return { actor, category, product, variant };
  }

  function asCustomer(userId: string) {
    currentUser = { id: userId, roles: ["CUSTOMER"] };
  }

  it("creates an anonymous cart lazily, only once a mutation actually happens", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 5 });

    const before = await cartService.getCart();
    expect(before.id).toBeNull();
    expect(fakeCookies.get("chaio_cart_token")).toBeUndefined();

    const after = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    expect(after.id).not.toBeNull();
    expect(fakeCookies.get("chaio_cart_token")).toBeDefined();

    const cartRow = await prisma.cart.findUniqueOrThrow({ where: { id: after.id! } });
    cleanup.push(() => prisma.cartItem.deleteMany({ where: { cartId: cartRow.id } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: cartRow.id } }));
    expect(cartRow.userId).toBeNull();
    expect(cartRow.anonymousToken).not.toBeNull();
  });

  it("creates an authenticated customer's cart keyed by userId, not a cookie", async () => {
    const { actor: customer, product, variant } = await setupPurchasableProduct({ stock: 5 });
    asCustomer(customer.id);

    const cart = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cartItem.deleteMany({ where: { cartId: cart.id! } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: cart.id! } }));

    const cartRow = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id! } });
    expect(cartRow.userId).toBe(customer.id);
    expect(cartRow.anonymousToken).toBeNull();
    expect(fakeCookies.get("chaio_cart_token")).toBeUndefined();
  });

  it("adding the same variant twice combines the quantity into one line", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 10 });

    await cartService.addItem({ productId: product.id, productVariantId: variant.id, quantity: 2 });
    const cart = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 3,
    });
    cleanup.push(() => prisma.cartItem.deleteMany({ where: { cartId: cart.id! } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: cart.id! } }));

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(5);
  });

  it("adding two different variants keeps them as separate line items", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 10 });
    // A second, independent product — each has its own single axis-less
    // variant (two axis-less variants on the SAME product would collide on
    // the "no axis" partial unique index; see product_variant_no_axis_unique).
    const { product: secondProduct, variant: secondVariant } = await setupPurchasableProduct({
      stock: 10,
    });

    await cartService.addItem({ productId: product.id, productVariantId: variant.id, quantity: 1 });
    const cart = await cartService.addItem({
      productId: secondProduct.id,
      productVariantId: secondVariant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cartItem.deleteMany({ where: { cartId: cart.id! } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: cart.id! } }));

    expect(cart.items).toHaveLength(2);
  });

  it("updates an item's quantity", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 10 });
    const added = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cartItem.deleteMany({ where: { cartId: added.id! } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: added.id! } }));

    const updated = await cartService.setItemQuantity(added.items[0].id, 4);
    expect(updated.items[0].quantity).toBe(4);
  });

  it("removes an item", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 10 });
    const added = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cart.delete({ where: { id: added.id! } }));

    const afterRemove = await cartService.removeItem(added.items[0].id);
    expect(afterRemove.items).toHaveLength(0);
  });

  it("clears the whole cart", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 10 });
    const { product: secondProduct, variant: secondVariant } = await setupPurchasableProduct({
      stock: 10,
    });
    const added1 = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cart.delete({ where: { id: added1.id! } }));
    await cartService.addItem({
      productId: secondProduct.id,
      productVariantId: secondVariant.id,
      quantity: 1,
    });

    const cleared = await cartService.clearCart();
    expect(cleared.items).toHaveLength(0);
  });

  it("rejects adding a variant whose product is not ACTIVE", async () => {
    // createProduct defaults to DRAFT — never activated for this test.
    const actor = await createTestUser({
      name: "Draft Actor",
      email: `cart-draft-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    const category = await createCategory({ name: `Draft Cat ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));
    const draftProduct = await createProduct(
      { name: `Draft Prod ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: draftProduct.id } }));
    const [draftVariant] = await createVariants(
      draftProduct.id,
      [{ sizeOptionId: null, colorId: null, sku: `DRAFT-SKU-${Date.now()}` }],
      actor.id,
    );
    // Pushed last so it pops (runs) first: ProductVariant.product is
    // onDelete: Restrict, so the variant must go before the product. Safe
    // to actually delete here (unlike setupPurchasableProduct's variants
    // above) — this addItem call is expected to throw, so no CartItem/
    // InventoryMovement ever ends up referencing this variant.
    cleanup.push(() => prisma.productVariant.delete({ where: { id: draftVariant.id } }));

    await expect(
      cartService.addItem({
        productId: draftProduct.id,
        productVariantId: draftVariant.id,
        quantity: 1,
      }),
    ).rejects.toThrow(cartService.ProductNotPurchasableError);
  });

  it("rejects adding an inactive variant", async () => {
    const { actor, product, variant } = await setupPurchasableProduct({ stock: 10 });
    const { deactivateVariant } = await import("@/modules/products/service");
    await deactivateVariant(variant.id, actor.id);

    await expect(
      cartService.addItem({ productId: product.id, productVariantId: variant.id, quantity: 1 }),
    ).rejects.toThrow(cartService.VariantInactiveError);
  });

  it("rejects a variant/product pair that doesn't actually match", async () => {
    const { actor, variant } = await setupPurchasableProduct({ stock: 10 });
    const otherProduct = await createProduct(
      { name: `Other Prod ${Date.now()}`, defaultPriceAmount: 500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: otherProduct.id } }));

    await expect(
      cartService.addItem({ productId: otherProduct.id, productVariantId: variant.id, quantity: 1 }),
    ).rejects.toThrow(cartService.VariantProductMismatchError);
  });

  it("rejects a quantity that exceeds current stock", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 2 });

    await expect(
      cartService.addItem({ productId: product.id, productVariantId: variant.id, quantity: 3 }),
    ).rejects.toThrow(cartService.InsufficientStockError);
  });

  it("a product without size/color axes (a single axis-less variant) can be added", async () => {
    const { product, variant } = await setupPurchasableProduct({ stock: 5 });
    expect(variant.sizeOptionId).toBeNull();
    expect(variant.colorId).toBeNull();

    const cart = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cart.delete({ where: { id: cart.id! } }));

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].sizeName).toBeNull();
    expect(cart.items[0].colorName).toBeNull();
  });

  it("a customer has at most one effective ACTIVE cart across repeated calls", async () => {
    const { actor: customer, product, variant } = await setupPurchasableProduct({ stock: 10 });
    asCustomer(customer.id);

    const first = await cartService.getOrCreateCart();
    cleanup.push(() => prisma.cart.delete({ where: { id: first.id! } }));
    const second = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });

    expect(second.id).toBe(first.id);
    const activeCartCount = await prisma.cart.count({
      where: { userId: customer.id, status: "ACTIVE" },
    });
    expect(activeCartCount).toBe(1);
  });

  it("merges an anonymous cart into the customer's cart on sign-in", async () => {
    const { actor: customer, product, variant } = await setupPurchasableProduct({ stock: 10 });

    // Shop as a guest first.
    const anonymousCart = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 2,
    });
    cleanup.push(() => prisma.cart.deleteMany({ where: { userId: customer.id } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: anonymousCart.id! } }).catch(() => {}) );

    // Now "sign in" as the customer — the anonymous cookie is still set.
    asCustomer(customer.id);
    const merged = await cartService.mergeAnonymousCartIntoCustomerCart();

    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].quantity).toBe(2);

    const anonymousCartRow = await prisma.cart.findUniqueOrThrow({ where: { id: anonymousCart.id! } });
    expect(anonymousCartRow.status).toBe("MERGED");
    expect(fakeCookies.get("chaio_cart_token")).toBeUndefined();
  });

  it("combines quantities when the customer already had the same variant in their own cart", async () => {
    const { actor: customer, product, variant } = await setupPurchasableProduct({ stock: 10 });

    const anonymousCart = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 2,
    });
    cleanup.push(() => prisma.cart.deleteMany({ where: { userId: customer.id } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: anonymousCart.id! } }).catch(() => {}));

    asCustomer(customer.id);
    // The customer already has 1 of the same variant in their own cart
    // BEFORE merging — the anonymous cart cookie is still attached from the
    // browsing above.
    fakeCookies.reset();
    await cartService.addItem({ productId: product.id, productVariantId: variant.id, quantity: 1 });
    // Re-attach the anonymous cookie manually to simulate "the browser still
    // has it" — in the real flow this cookie is never cleared until merge.
    const rawToken = (await prisma.cart.findUniqueOrThrow({ where: { id: anonymousCart.id! } }))
      .anonymousToken!;
    fakeCookies.set("chaio_cart_token", rawToken);

    const merged = await cartService.mergeAnonymousCartIntoCustomerCart();
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].quantity).toBe(3); // 1 (customer's own) + 2 (anonymous)
  });

  it("a repeated merge request is idempotent — the second call is a safe no-op", async () => {
    const { actor: customer, product, variant } = await setupPurchasableProduct({ stock: 10 });

    const anonymousCart = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 2,
    });
    cleanup.push(() => prisma.cart.deleteMany({ where: { userId: customer.id } }));
    cleanup.push(() => prisma.cart.delete({ where: { id: anonymousCart.id! } }).catch(() => {}));

    asCustomer(customer.id);
    const firstMerge = await cartService.mergeAnonymousCartIntoCustomerCart();
    const secondMerge = await cartService.mergeAnonymousCartIntoCustomerCart();

    expect(secondMerge.items).toHaveLength(1);
    expect(secondMerge.items[0].quantity).toBe(firstMerge.items[0].quantity);
  });

  it("one customer cannot read or mutate another customer's cart items", async () => {
    const { actor: customerA, product, variant } = await setupPurchasableProduct({ stock: 10 });
    const customerB = await createTestUser({
      name: "Customer B",
      email: `cart-customer-b-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(customerB.id);

    asCustomer(customerA.id);
    const cartA = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cart.delete({ where: { id: cartA.id! } }));
    const itemAId = cartA.items[0].id;

    asCustomer(customerB.id);
    await expect(cartService.setItemQuantity(itemAId, 2)).rejects.toThrow(
      cartService.CartItemNotFoundError,
    );
    // A no-op against B's OWN (empty) cart — itemAId simply isn't found
    // there, never A's item.
    const bResult = await cartService.removeItem(itemAId);
    expect(bResult.items).toHaveLength(0);
    cleanup.push(() => prisma.cart.deleteMany({ where: { userId: customerB.id } }));

    asCustomer(customerA.id);
    const stillThere = await cartService.getCart();
    expect(stillThere.items.find((i) => i.id === itemAId)?.quantity).toBe(1);
  });

  it("always resolves the current authoritative price, never a stale or client-submitted one", async () => {
    const { actor, product, variant } = await setupPurchasableProduct({ stock: 10, priceAmount: 1000n });

    const added = await cartService.addItem({
      productId: product.id,
      productVariantId: variant.id,
      quantity: 1,
    });
    cleanup.push(() => prisma.cart.delete({ where: { id: added.id! } }));
    expect(added.items[0].unitPriceDisplay).toContain("10,00");

    // Price changes after the item was added.
    await updateProduct(product.id, { defaultPriceAmount: 2500n }, actor.id);

    const refreshed = await cartService.getCart();
    expect(refreshed.items[0].unitPriceDisplay).toContain("25,00");
    expect(refreshed.items[0].issues.map((i) => i.code)).toContain("PRICE_CHANGED");
  });
});
