import "server-only";

import { minorUnitsToDisplay } from "@/lib/money";
import { prisma } from "@/lib/db";
import { timed } from "@/lib/timing";
import { getInventoryBalance } from "@/modules/inventory/service";
import { getEffectivePrice } from "@/modules/products/pricing";
import { getProductImagePublicUrl } from "@/modules/products/product-images";
import { isPubliclyVisible } from "@/modules/products/visibility";
import { getStoreConfiguration } from "@/modules/store-settings/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";
import type { Cart } from "@/generated/prisma/client";

import { isCartActiveUserConflict } from "./concurrency";
import { MAX_ITEM_QUANTITY } from "./constants";
import {
  CartItemNotFoundError,
  InsufficientStockError,
  InvalidQuantityError,
  ProductNotPurchasableError,
  QuantityLimitExceededError,
  VariantInactiveError,
  VariantNotFoundError,
  VariantProductMismatchError,
} from "./errors";
import {
  ANONYMOUS_CART_TTL_DAYS,
  clearAnonymousCartCookie,
  issueAnonymousCartCookie,
  peekAnonymousCartToken,
  resolveCartIdentityForMutation,
  resolveCartIdentityReadOnly,
  type CartIdentity,
} from "./identity";
import { computeCartItemIssues, isBlockingIssue, type CartItemIssue } from "./issues";
import { computeMergedQuantity } from "./merge-policy";

export * from "./errors";
export type { CartIdentity } from "./identity";
export type { CartItemIssue, CartItemIssueCode } from "./issues";
export { MAX_ITEM_QUANTITY } from "./constants";

// =============================================================================
// DTOs — never leak a raw bigint, an internal id shape, or an exact
// warehouse-level stock count across the Server Action / Client Component
// boundary. Mirrors the same redaction discipline as
// modules/products/public-queries.ts.
// =============================================================================

export interface CartItemDTO {
  id: string;
  productId: string;
  productSlug: string;
  productVariantId: string;
  productName: string;
  sizeName: string | null;
  colorName: string | null;
  sku: string;
  quantity: number;
  unitPriceDisplay: string;
  lineTotalDisplay: string;
  imageUrl: string | null;
  issues: CartItemIssue[];
}

export interface CartDTO {
  id: string | null;
  currency: string;
  itemCount: number;
  items: CartItemDTO[];
  subtotalDisplay: string;
  hasIssues: boolean;
}

function emptyCartDTO(currency: string): CartDTO {
  return { id: null, currency, itemCount: 0, items: [], subtotalDisplay: minorUnitsToDisplay(0n, { currency }), hasIssues: false };
}

// Same shape as emptyCartDTO, but for a cart row that genuinely exists (a
// real id) and is merely known to have zero items yet — see
// getOrCreateCartForIdentity's freshlyCreated fast path.
function emptyCartDTOForCart(cart: Cart): CartDTO {
  return {
    id: cart.id,
    currency: cart.currency,
    itemCount: 0,
    items: [],
    subtotalDisplay: minorUnitsToDisplay(0n, { currency: cart.currency }),
    hasIssues: false,
  };
}

// =============================================================================
// Internal — resolving a variant's current, authoritative purchase state.
// The single place both blocking validation (addItem/setItemQuantity) and
// non-blocking issue detection (getCart) read from, so the two can never
// silently disagree about what "purchasable" means.
// =============================================================================

async function loadVariantSnapshot(variantId: string) {
  return prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: { include: { variants: { select: { isActive: true, priceAmount: true } } } },
    },
  });
}

type VariantSnapshot = NonNullable<Awaited<ReturnType<typeof loadVariantSnapshot>>>;

interface PurchasabilityInput {
  status: string;
  categoryId: string | null;
  defaultPriceAmount: bigint | null;
  variants: { isActive: boolean; priceAmount: bigint | null }[];
}

// Product-level visibility uses the exact same rule /catalog and
// /product/[slug] use (modules/products/visibility.ts) — never a second,
// looser re-implementation for the cart. Takes a plain product-shaped
// input (not a full VariantSnapshot) so both assertPurchasable (via a
// loaded variant's `.product`) and toCartDTO (via a cart item's already-
// loaded `.productVariant.product`) can call this without reshaping data.
function isProductPurchasable(product: PurchasabilityInput): boolean {
  return isPubliclyVisible(
    {
      status: product.status,
      categoryId: product.categoryId,
      defaultPriceAmount: product.defaultPriceAmount,
    },
    product.variants,
  );
}

// Reads the same single (isDefault) warehouse the public storefront's own
// stock status reads — see docs/adr/0002-inventory-balance-projection.md
// and public-queries.ts's getPublicProductBySlug. A cart validation that
// used a different (e.g. summed-across-warehouses) figure could accept a
// quantity the product page itself would show as out of stock.
async function getAvailableStock(variantId: string): Promise<number> {
  const defaultWarehouse = await getDefaultWarehouse();
  if (!defaultWarehouse) return 0;
  const balance = await getInventoryBalance(variantId, defaultWarehouse.id);
  return balance?.quantity ?? 0;
}

interface PurchaseCheck {
  snapshot: VariantSnapshot;
  effectivePrice: bigint;
  availableStock: number;
}

// The blocking half: throws a specific, typed error the moment any
// condition fails, for addItem/setItemQuantity to reject the mutation
// outright — never partially applied. `expectedProductId` is checked only
// when the caller actually has an independent productId to verify against
// (addItem, where the client supplies both ids) — setItemQuantity/removeItem
// derive everything from a server-looked-up cart item instead, so there is
// no second, independently-submitted id to cross-check there.
async function assertPurchasable(
  expectedProductId: string | null,
  variantId: string,
  quantity: number,
): Promise<PurchaseCheck> {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new InvalidQuantityError(quantity);
  if (quantity > MAX_ITEM_QUANTITY) throw new QuantityLimitExceededError(quantity, MAX_ITEM_QUANTITY);

  const snapshot = await loadVariantSnapshot(variantId);
  if (!snapshot) throw new VariantNotFoundError(variantId);
  if (expectedProductId !== null && snapshot.productId !== expectedProductId) {
    throw new VariantProductMismatchError();
  }
  if (!snapshot.isActive) throw new VariantInactiveError(variantId);
  if (!isProductPurchasable(snapshot.product)) throw new ProductNotPurchasableError(snapshot.productId);

  const effectivePrice = getEffectivePrice({
    variantPriceAmount: snapshot.priceAmount,
    productDefaultPriceAmount: snapshot.product.defaultPriceAmount,
  });
  // isProductPurchasable already guarantees every active variant of a
  // visible product has a positive effective price — this is a defensive
  // re-check, not the primary enforcement point.
  if (effectivePrice === null || effectivePrice <= 0n) {
    throw new ProductNotPurchasableError(snapshot.productId);
  }

  const availableStock = await getAvailableStock(variantId);
  if (availableStock < quantity) {
    throw new InsufficientStockError(variantId, quantity, availableStock);
  }

  return { snapshot, effectivePrice, availableStock };
}

// =============================================================================
// Cart row resolution — identity in, a real Cart row out. The only place
// Cart rows are created; every mutation goes through this first.
// =============================================================================

async function findActiveCartForUser(userId: string) {
  return prisma.cart.findFirst({ where: { userId, status: "ACTIVE" } });
}

async function createCartForUser(userId: string): Promise<Cart> {
  const { currency } = await getStoreConfiguration();
  try {
    return await prisma.cart.create({ data: { userId, status: "ACTIVE", currency } });
  } catch (error) {
    if (isCartActiveUserConflict(error)) {
      // Lost a create race against a concurrent request for the same
      // customer — the winner's row is what we want, not a thrown error.
      const winner = await findActiveCartForUser(userId);
      if (winner) return winner;
    }
    throw error;
  }
}

function isAnonymousCartUsable(cart: Cart): boolean {
  return cart.status === "ACTIVE" && (!cart.expiresAt || cart.expiresAt > new Date());
}

function anonymousExpiryDate(): Date {
  return new Date(Date.now() + ANONYMOUS_CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

interface CartRowResult {
  cart: Cart;
  // True only for a row this call just inserted — a brand-new Cart can
  // never have items yet, so a DTO-producing caller can skip toCartDTO's
  // cartItem query entirely (measured at ~2.4s against the real dev
  // database for an empty result — the join shape costs that even with
  // zero matching rows) instead of re-deriving the same "no items" answer
  // the database would have given anyway.
  freshlyCreated: boolean;
}

// Server-Action-only: may issue a brand-new anonymous cookie (see
// resolveCartIdentityForMutation/issueAnonymousCartCookie), which throws if
// called during a Server Component render. Split from getOrCreateCartRow
// below so a caller that has *already* resolved the identity this request
// (mergeAnonymousCartIntoCustomerCart) never pays a second, redundant
// resolveCartIdentityForMutation/getCurrentUser round trip — each one costs
// a real session+permission DB lookup, ~1.4s measured against the real
// (remote) dev database, so resolving it twice in one action genuinely
// doubles that cost for no reason.
async function getOrCreateCartRowWithFreshness(identity: CartIdentity): Promise<CartRowResult> {
  if (identity.type === "user") {
    const existing = await timed("cart.findActiveCartForUser", () =>
      findActiveCartForUser(identity.userId),
    );
    if (existing) return { cart: existing, freshlyCreated: false };
    const created = await timed("cart.createCartForUser", () =>
      createCartForUser(identity.userId),
    );
    return { cart: created, freshlyCreated: true };
  }

  const { currency } = await timed("cart.getStoreConfiguration", () => getStoreConfiguration());

  const token = identity.token;
  if (token) {
    const existing = await timed("cart.findByAnonymousToken", () =>
      prisma.cart.findUnique({ where: { anonymousToken: token } }),
    );
    if (existing && isAnonymousCartUsable(existing)) {
      // Touch the expiry forward on every active use — an anonymous cart
      // being actively shopped must not expire mid-session.
      const touched = await timed("cart.touchExpiry", () =>
        prisma.cart.update({ where: { id: existing.id }, data: { expiresAt: anonymousExpiryDate() } }),
      );
      return { cart: touched, freshlyCreated: false };
    }
    // The token names a cart that's gone stale (expired) or is no longer
    // ACTIVE (e.g. already MERGED from a prior sign-in using the same
    // browser) — fall through to issuing a fresh token/cookie/row below.
    // The old row is left as-is; it's already correctly not reachable.
  }

  const newToken = await timed("cart.issueAnonymousCartCookie", () => issueAnonymousCartCookie());
  const created = await timed("cart.createAnonymousCart", () =>
    prisma.cart.create({
      data: {
        anonymousToken: newToken,
        status: "ACTIVE",
        currency,
        expiresAt: anonymousExpiryDate(),
      },
    }),
  );
  return { cart: created, freshlyCreated: true };
}

async function getOrCreateCartRowForIdentity(identity: CartIdentity): Promise<Cart> {
  const { cart } = await getOrCreateCartRowWithFreshness(identity);
  return cart;
}

async function getOrCreateCartRow(): Promise<Cart> {
  const identity = await timed("cart.resolveIdentity(mutation)", () =>
    resolveCartIdentityForMutation(),
  );
  return getOrCreateCartRowForIdentity(identity);
}

// Read-only lookup for display paths (Server Components) — never creates a
// row, never writes a cookie. Returns null when no usable cart exists yet.
async function findExistingCartRow(): Promise<Cart | null> {
  const identity = await resolveCartIdentityReadOnly();

  if (identity.type === "user") {
    return findActiveCartForUser(identity.userId);
  }
  if (!identity.token) return null;

  const cart = await prisma.cart.findUnique({ where: { anonymousToken: identity.token } });
  return cart && isAnonymousCartUsable(cart) ? cart : null;
}

// =============================================================================
// DTO assembly — shared by getCart/getOrCreateCart so the two can never
// disagree about shape or issue detection.
// =============================================================================

async function toCartDTO(cart: Cart): Promise<CartDTO> {
  const items = await timed("cart.toCartDTO.findItems", () =>
    prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { createdAt: "asc" },
      include: {
        productVariant: {
          include: {
            sizeOption: true,
            color: true,
            product: {
              include: {
                variants: { select: { isActive: true, priceAmount: true } },
                // The product's primary image — same source the storefront's
                // own product card/detail page use (see
                // components/catalog/product-card.tsx); this app has no
                // separate variant-scoped image selection anywhere else.
                images: { where: { isPrimary: true }, take: 1 },
              },
            },
          },
        },
      },
    }),
  );

  let subtotal = 0n;
  let itemCount = 0;
  let hasIssues = false;

  const itemDTOs: CartItemDTO[] = [];

  for (const item of items) {
    const variant = item.productVariant;
    const product = variant.product;
    const productPurchasable = isProductPurchasable(product);

    const currentPrice = getEffectivePrice({
      variantPriceAmount: variant.priceAmount,
      productDefaultPriceAmount: product.defaultPriceAmount,
    });
    const resolvedPrice = currentPrice !== null && currentPrice > 0n ? currentPrice : item.observedUnitPriceAmount;
    const availableStock = await getAvailableStock(item.productVariantId);

    const issues = computeCartItemIssues({
      variantIsActive: variant.isActive,
      productPurchasable,
      currentEffectivePrice: currentPrice,
      observedUnitPriceAmount: item.observedUnitPriceAmount,
      availableStock,
      quantity: item.quantity,
    });

    // Blocking issues (everything except a plain price change) exclude the
    // item from the subtotal — it isn't something the customer could
    // actually check out with right now. See modules/cart/issues.ts.
    if (!issues.some(isBlockingIssue)) {
      subtotal += resolvedPrice * BigInt(item.quantity);
      itemCount += item.quantity;
    }
    if (issues.length > 0) hasIssues = true;

    const primaryImage = product.images[0] ?? null;

    itemDTOs.push({
      id: item.id,
      productId: product.id,
      productSlug: product.slug,
      productVariantId: variant.id,
      productName: product.name,
      sizeName: variant.sizeOption?.label ?? null,
      colorName: variant.color?.displayName ?? null,
      sku: variant.sku,
      quantity: item.quantity,
      unitPriceDisplay: minorUnitsToDisplay(resolvedPrice, { currency: cart.currency }),
      lineTotalDisplay: minorUnitsToDisplay(resolvedPrice * BigInt(item.quantity), { currency: cart.currency }),
      imageUrl: primaryImage ? getProductImagePublicUrl(primaryImage) : null,
      issues,
    });
  }

  return {
    id: cart.id,
    currency: cart.currency,
    itemCount,
    items: itemDTOs,
    subtotalDisplay: minorUnitsToDisplay(subtotal, { currency: cart.currency }),
    hasIssues,
  };
}

// =============================================================================
// Public operations
// =============================================================================

// Read-only — safe from a Server Component. Never creates a cart or writes
// a cookie; an anonymous visitor with no cookie yet simply sees an empty
// cart, exactly as if one existed with zero items.
export async function getCart(): Promise<CartDTO> {
  const cart = await findExistingCartRow();
  if (!cart) {
    const { currency } = await getStoreConfiguration();
    return emptyCartDTO(currency);
  }
  return toCartDTO(cart);
}

// Shares the already-resolved identity with a caller that has one (see
// getOrCreateCartRowForIdentity above) instead of resolving it again.
async function getOrCreateCartForIdentity(identity: CartIdentity): Promise<CartDTO> {
  const { cart, freshlyCreated } = await getOrCreateCartRowWithFreshness(identity);
  // A row this call just inserted can't have items yet — skip toCartDTO's
  // query instead of re-deriving "zero items" the expensive way. See
  // CartRowResult's doc comment.
  if (freshlyCreated) return emptyCartDTOForCart(cart);
  return toCartDTO(cart);
}

// Server-Action-only. Guarantees a real Cart row exists (creating one, and
// the anonymous cookie alongside it, if needed) and returns its DTO.
export async function getOrCreateCart(): Promise<CartDTO> {
  const identity = await resolveCartIdentityForMutation();
  return getOrCreateCartForIdentity(identity);
}

export interface AddItemInput {
  productId: string;
  productVariantId: string;
  quantity: number;
}

// Combines with an existing line for the same variant (never a second row —
// see the cartId+productVariantId unique constraint) — the combined
// quantity is capped by both MAX_ITEM_QUANTITY and current stock, the same
// two limits a first-time add is checked against.
export async function addItem(input: AddItemInput): Promise<CartDTO> {
  // Validated up front, against the raw requested quantity — not just the
  // post-combination total below — so e.g. a negative or non-integer
  // `input.quantity` is rejected outright instead of silently shrinking an
  // existing line.
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new InvalidQuantityError(input.quantity);
  }

  const cart = await getOrCreateCartRow();

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productVariantId: { cartId: cart.id, productVariantId: input.productVariantId } },
  });
  const targetQuantity = Math.min(
    (existing?.quantity ?? 0) + input.quantity,
    MAX_ITEM_QUANTITY,
  );

  const { effectivePrice } = await assertPurchasable(input.productId, input.productVariantId, targetQuantity);

  await prisma.cartItem.upsert({
    where: { cartId_productVariantId: { cartId: cart.id, productVariantId: input.productVariantId } },
    update: { quantity: targetQuantity, observedUnitPriceAmount: effectivePrice },
    create: {
      cartId: cart.id,
      productVariantId: input.productVariantId,
      quantity: targetQuantity,
      observedUnitPriceAmount: effectivePrice,
    },
  });

  return toCartDTO(cart);
}

export async function setItemQuantity(itemId: string, quantity: number): Promise<CartDTO> {
  const cart = await getOrCreateCartRow();

  // Scoped by cartId, never just itemId — this is the ownership check: an
  // itemId belonging to a different visitor's cart simply isn't found here.
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
  if (!item) throw new CartItemNotFoundError();

  // No expectedProductId to cross-check here — everything is derived from
  // the server-looked-up item above, not from client-submitted ids.
  const { effectivePrice } = await assertPurchasable(null, item.productVariantId, quantity);

  await prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity, observedUnitPriceAmount: effectivePrice },
  });

  return toCartDTO(cart);
}

export async function removeItem(itemId: string): Promise<CartDTO> {
  const cart = await getOrCreateCartRow();
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
  return toCartDTO(cart);
}

export async function clearCart(): Promise<CartDTO> {
  const cart = await getOrCreateCartRow();
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return toCartDTO(cart);
}

// =============================================================================
// Anonymous → customer merge. See the module doc comment below for the
// exact, documented conflict policy.
// =============================================================================

// Merge-conflict policy (the exact rule, spelled out):
//   1. For each item in the anonymous cart, look for an existing line for
//      the same productVariantId in the customer's ACTIVE cart.
//   2. If found: the two quantities are ADDED together (never one
//      overwriting the other — neither cart's choice "wins" outright).
//   3. If not found: the anonymous item becomes a new line as-is.
//   4. Either way, the resulting quantity is CAPPED at
//      min(combinedQuantity, MAX_ITEM_QUANTITY, currentAvailableStock) —
//      the same two limits every other mutation enforces. Capping is not
//      itself an error and raises no issue (the capped value is, by
//      definition, valid) — this mirrors how addItem itself caps rather
//      than rejects when combining would otherwise exceed a limit. The
//      stock cap is skipped (not applied) when available stock is exactly
//      zero, specifically so the item is carried over instead of zeroed —
//      see step 5.
//   5. Purchasability (active product/variant) is deliberately NOT
//      re-checked during merge — an already-invalid anonymous item is
//      still carried over, then flagged by the exact same issue-detection
//      getCart always runs, rather than silently dropped. See "Do not
//      silently remove problematic items" in the cart requirements.
//   6. The anonymous cart is marked MERGED and its cookie cleared in the
//      same transaction as the item writes — it can never be looked up
//      (by its old token, which no longer exists client-side, or by
//      status) as ACTIVE again.
//   7. Idempotent by construction: re-running this with the same
//      (now-stale) anonymous token finds nothing ACTIVE to merge and is a
//      pure no-op — never a second merge of the same items.
export async function mergeAnonymousCartIntoCustomerCart(): Promise<CartDTO> {
  const identity = await timed("cart.merge.resolveIdentity", () => resolveCartIdentityForMutation());
  if (identity.type !== "user") {
    // Not signed in as a CUSTOMER (e.g. staff/admin, or a genuine guest) —
    // nothing to merge into. Callers only invoke this right after a
    // CUSTOMER sign-in/registration succeeds. Shares the identity already
    // resolved above — see getOrCreateCartRowForIdentity's doc comment.
    return getOrCreateCartForIdentity(identity);
  }

  // Raw cookie peek, not resolveCartIdentityReadOnly: the visitor is
  // already a signed-in CUSTOMER by this point, so the normal resolver
  // would only ever report `{ type: "user" }` and never surface the
  // leftover anonymous cookie from their pre-login browsing. See
  // identity.ts's doc comment on peekAnonymousCartToken.
  const cookieToken = await peekAnonymousCartToken();
  if (!cookieToken) return getOrCreateCartForIdentity(identity);

  const anonymousCart = await prisma.cart.findUnique({
    where: { anonymousToken: cookieToken },
    include: { items: true },
  });

  if (!anonymousCart || anonymousCart.status !== "ACTIVE" || anonymousCart.items.length === 0) {
    // Nothing usable to merge (already merged, expired, or empty) — still
    // clear a lingering cookie so a stale/merged token is never reused.
    // This is also what makes a repeated merge request idempotent: the
    // second call finds status !== "ACTIVE" here and simply no-ops.
    await clearAnonymousCartCookie();
    return getOrCreateCartForIdentity(identity);
  }

  const customerCart =
    (await findActiveCartForUser(identity.userId)) ?? (await createCartForUser(identity.userId));

  const existingCustomerItems = await prisma.cartItem.findMany({
    where: { cartId: customerCart.id },
  });
  const existingByVariant = new Map(existingCustomerItems.map((item) => [item.productVariantId, item]));

  await prisma.$transaction(async (tx) => {
    for (const anonymousItem of anonymousCart.items) {
      const existing = existingByVariant.get(anonymousItem.productVariantId);
      const availableStock = await getAvailableStock(anonymousItem.productVariantId);
      const quantityToWrite = computeMergedQuantity({
        existingQuantity: existing?.quantity ?? 0,
        incomingQuantity: anonymousItem.quantity,
        availableStock,
        maxQuantity: MAX_ITEM_QUANTITY,
      });

      await tx.cartItem.upsert({
        where: {
          cartId_productVariantId: { cartId: customerCart.id, productVariantId: anonymousItem.productVariantId },
        },
        update: {
          quantity: quantityToWrite,
          observedUnitPriceAmount: anonymousItem.observedUnitPriceAmount,
        },
        create: {
          cartId: customerCart.id,
          productVariantId: anonymousItem.productVariantId,
          quantity: quantityToWrite,
          observedUnitPriceAmount: anonymousItem.observedUnitPriceAmount,
        },
      });
    }

    await tx.cart.update({ where: { id: anonymousCart.id }, data: { status: "MERGED" } });
  });

  await clearAnonymousCartCookie();

  return toCartDTO(customerCart);
}
