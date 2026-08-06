// Pure — no imports, no "server-only", no DB. The non-blocking half of cart
// validation: given an already-resolved snapshot of a cart item's current
// state (variant/product/price/stock, all fetched by the caller — see
// modules/cart/service.ts's toCartDTO), decide what's wrong with it, if
// anything. Never removes anything itself — "do not silently remove
// problematic items" is enforced by construction: this only ever produces
// a list to display, never a mutation.

export type CartItemIssueCode =
  | "PRODUCT_INACTIVE"
  | "VARIANT_INACTIVE"
  // Never actually produced today: ProductVariant is deactivated, never
  // hard-deleted (modules/products/service.ts's deactivateVariant), and
  // CartItem.productVariantId is onDelete: Restrict, so a cart item can't
  // outlive its variant. Kept in the type for the documented requirement
  // and so a future hard-delete path has somewhere to report into.
  | "VARIANT_REMOVED"
  | "INSUFFICIENT_STOCK"
  | "PRICE_CHANGED";

export interface CartItemIssue {
  code: CartItemIssueCode;
  message: string;
}

export interface CartItemIssueInput {
  variantIsActive: boolean;
  productPurchasable: boolean;
  // The current, freshly-resolved effective price — null only in the
  // defensive/unreachable case where a variant has no resolvable price at
  // all (already implied by !productPurchasable in practice).
  currentEffectivePrice: bigint | null;
  observedUnitPriceAmount: bigint;
  availableStock: number;
  quantity: number;
}

export function computeCartItemIssues(input: CartItemIssueInput): CartItemIssue[] {
  const issues: CartItemIssue[] = [];

  // Mutually exclusive on purpose: an inactive variant already implies the
  // product-level check is moot for THIS item's purposes, and reporting
  // both would just be noise for the same underlying "can't buy this"
  // fact.
  if (!input.variantIsActive) {
    issues.push({ code: "VARIANT_INACTIVE", message: "Esta variante ya no está disponible." });
  } else if (!input.productPurchasable) {
    issues.push({ code: "PRODUCT_INACTIVE", message: "Este producto ya no está disponible." });
  }

  if (
    input.currentEffectivePrice !== null &&
    input.currentEffectivePrice !== input.observedUnitPriceAmount
  ) {
    issues.push({
      code: "PRICE_CHANGED",
      message: "El precio de este artículo cambió desde que lo agregaste.",
    });
  }

  if (input.availableStock < input.quantity) {
    issues.push({
      code: "INSUFFICIENT_STOCK",
      message:
        input.availableStock > 0
          ? `Solo quedan ${input.availableStock} unidades disponibles.`
          : "Este artículo ya no tiene stock disponible.",
    });
  }

  return issues;
}

// Every issue except a plain price change excludes an item from the cart
// subtotal — it isn't something the customer could actually check out with
// right now. A price change alone does not: the item stays counted, priced
// at the new (current) amount.
export function isBlockingIssue(issue: CartItemIssue): boolean {
  return issue.code !== "PRICE_CHANGED";
}
