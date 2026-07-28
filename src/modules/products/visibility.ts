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

// A product must not be publicly visible unless: status allows publication
// (ACTIVE), it has a category, it has at least one active variant, and every
// active variant has a positive effective price. This is the single
// function both /catalog and /product/[slug] call — never duplicated logic
// per route.
export function isPubliclyVisible(
  product: VisibilityProductInput,
  variants: readonly VisibilityVariantInput[],
): boolean {
  if (product.status !== "ACTIVE") return false;
  if (!product.categoryId) return false;

  const activeVariants = variants.filter((variant) => variant.isActive);
  if (activeVariants.length === 0) return false;

  return activeVariants.every((variant) => {
    const price = getEffectivePrice({
      variantPriceAmount: variant.priceAmount,
      productDefaultPriceAmount: product.defaultPriceAmount,
    });
    return price !== null && price > 0n;
  });
}
