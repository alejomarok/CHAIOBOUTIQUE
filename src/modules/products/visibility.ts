import { getEffectivePrice } from "./pricing";

export interface VisibilityProductInput {
  status: string;
  categoryId: string | null;
  defaultPriceAmount: bigint | null;
}

export interface VisibilityVariantInput {
  isActive: boolean;
  priceAmount: bigint | null;
}

export type VisibilityBlockerCode =
  | "NOT_ACTIVE_STATUS"
  | "NO_CATEGORY"
  | "NO_ACTIVE_VARIANTS"
  | "VARIANT_MISSING_PRICE";

export interface VisibilityBlocker {
  code: VisibilityBlockerCode;
  message: string;
}

// The single source of truth for "why isn't this product visible on
// /catalog or /product/[slug]" — everywhere that needs the yes/no answer
// (isPubliclyVisible, below) or the human-readable reasons (the admin
// product detail page) reads from this one list, never a second
// re-implementation of the same rule. See DATABASE.md's "Public
// visibility" section for the documented policy this encodes:
//   1. status must be ACTIVE (DRAFT/INACTIVE/ARCHIVED are never shown).
//   2. the product must have a category.
//   3. it must have at least one active variant.
//   4. every active variant must resolve to a positive effective price
//      (its own priceAmount, or the product's defaultPriceAmount as a
//      fallback — see modules/products/pricing.ts).
// Deliberately NOT a condition: having an image. A valid, active,
// correctly-priced product is still publicly visible with zero images —
// the storefront renders a placeholder instead of hiding the product; see
// components/catalog/product-card.tsx.
export function getVisibilityBlockers(
  product: VisibilityProductInput,
  variants: readonly VisibilityVariantInput[],
): VisibilityBlocker[] {
  const blockers: VisibilityBlocker[] = [];

  if (product.status !== "ACTIVE") {
    blockers.push({
      code: "NOT_ACTIVE_STATUS",
      message: 'El producto no está publicado — su estado debe ser "Activo".',
    });
  }

  if (!product.categoryId) {
    blockers.push({
      code: "NO_CATEGORY",
      message: "El producto no tiene una categoría asignada.",
    });
  }

  const activeVariants = variants.filter((variant) => variant.isActive);
  if (activeVariants.length === 0) {
    blockers.push({
      code: "NO_ACTIVE_VARIANTS",
      message: "El producto no tiene ninguna variante activa.",
    });
  } else {
    const hasVariantWithoutValidPrice = activeVariants.some((variant) => {
      const price = getEffectivePrice({
        variantPriceAmount: variant.priceAmount,
        productDefaultPriceAmount: product.defaultPriceAmount,
      });
      return price === null || price <= 0n;
    });
    if (hasVariantWithoutValidPrice) {
      blockers.push({
        code: "VARIANT_MISSING_PRICE",
        message:
          "Una o más variantes activas no tienen un precio válido (ni propio ni heredado del producto).",
      });
    }
  }

  return blockers;
}

// A product must not be publicly visible unless it has zero visibility
// blockers (see getVisibilityBlockers above). This is the single function
// both /catalog and /product/[slug] call — never duplicated logic per
// route.
export function isPubliclyVisible(
  product: VisibilityProductInput,
  variants: readonly VisibilityVariantInput[],
): boolean {
  return getVisibilityBlockers(product, variants).length === 0;
}
