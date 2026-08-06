// Pure — no "server-only", no DB, no imports. The numeric core of the
// anonymous-cart merge-conflict policy documented in full on
// modules/cart/service.ts's mergeAnonymousCartIntoCustomerCart: sum the two
// quantities, cap by the per-item quantity limit always, and additionally
// cap by current available stock only when stock is actually > 0 — a
// genuinely out-of-stock item is carried over at the limit-capped quantity
// instead of being silently zeroed, and is left for getCart's normal
// INSUFFICIENT_STOCK issue detection to flag for the customer to resolve.
export function computeMergedQuantity(input: {
  existingQuantity: number;
  incomingQuantity: number;
  availableStock: number;
  maxQuantity: number;
}): number {
  const combined = input.existingQuantity + input.incomingQuantity;
  const cappedByLimit = Math.min(combined, input.maxQuantity);
  return input.availableStock > 0 ? Math.min(cappedByLimit, input.availableStock) : cappedByLimit;
}
