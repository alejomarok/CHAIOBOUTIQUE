// Pure — no "server-only", no DB import — unit-testable in isolation. All
// monetary values are BigInt minor units (see docs/adr/0001-monetary-
// strategy.md) — never Number/Decimal/Float, so this arithmetic is exact
// regardless of amount size, matching every other monetary calculation in
// this codebase (e.g. modules/products/pricing.ts).

export class InvalidSaleItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSaleItemError";
  }
}

export interface SaleItemAmountInput {
  quantity: number;
  unitPriceAmount: bigint;
  discountAmount: bigint;
}

export interface ComputedSaleItemTotals {
  subtotalAmount: bigint;
  totalAmount: bigint;
}

// Validates and computes one line item's totals server-side — never trusts
// a client-computed subtotal/total. See this phase's business rules:
// quantity > 0, unitPrice >= 0, discount >= 0, and a discount can never
// exceed its own line's subtotal (which would make totalAmount negative).
export function computeSaleItemTotals(input: SaleItemAmountInput): ComputedSaleItemTotals {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new InvalidSaleItemError("La cantidad debe ser mayor a 0.");
  }
  if (input.unitPriceAmount < 0n) {
    throw new InvalidSaleItemError("El precio unitario no puede ser negativo.");
  }
  if (input.discountAmount < 0n) {
    throw new InvalidSaleItemError("El descuento no puede ser negativo.");
  }

  const subtotalAmount = input.unitPriceAmount * BigInt(input.quantity);
  if (input.discountAmount > subtotalAmount) {
    throw new InvalidSaleItemError("El descuento no puede ser mayor al subtotal del producto.");
  }

  return { subtotalAmount, totalAmount: subtotalAmount - input.discountAmount };
}

export interface ComputedSaleTotals {
  subtotalAmount: bigint;
  discountTotalAmount: bigint;
  totalAmount: bigint;
}

// Sums already-computed item totals into the sale-level totals — the sale's
// subtotal/discountTotal/total are always a straight sum of its items,
// never independently entered. taxTotalAmount is deliberately not computed
// here — see Sale.taxTotalAmount's own schema comment: always 0 this
// phase, no fiscal model exists yet (ARCA is out of scope).
export function computeSaleTotals(
  items: Array<{ subtotalAmount: bigint; discountAmount: bigint; totalAmount: bigint }>,
): ComputedSaleTotals {
  let subtotalAmount = 0n;
  let discountTotalAmount = 0n;
  let totalAmount = 0n;
  for (const item of items) {
    subtotalAmount += item.subtotalAmount;
    discountTotalAmount += item.discountAmount;
    totalAmount += item.totalAmount;
  }
  return { subtotalAmount, discountTotalAmount, totalAmount };
}
