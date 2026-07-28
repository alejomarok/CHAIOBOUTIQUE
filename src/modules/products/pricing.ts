// Pure pricing rules — see docs/adr/0001-monetary-strategy.md.

export class InvalidCompareAtPriceError extends Error {
  constructor() {
    super("El precio de comparación debe ser mayor al precio de venta efectivo.");
    this.name = "InvalidCompareAtPriceError";
  }
}

export interface EffectivePriceInputs {
  variantPriceAmount: bigint | null;
  productDefaultPriceAmount: bigint | null;
}

// effectiveVariantPrice = variant.priceAmount ?? product.defaultPriceAmount
export function getEffectivePrice(input: EffectivePriceInputs): bigint | null {
  return input.variantPriceAmount ?? input.productDefaultPriceAmount;
}

// A compare-at price, when provided, must be strictly greater than the
// effective price it's being compared against — never silently accepted
// otherwise. No-op when either side is absent (nothing to compare yet).
export function validateCompareAtPrice(
  effectivePrice: bigint | null,
  compareAtPrice: bigint | null | undefined,
): void {
  if (compareAtPrice == null || effectivePrice == null) return;
  if (compareAtPrice <= effectivePrice) throw new InvalidCompareAtPriceError();
}
