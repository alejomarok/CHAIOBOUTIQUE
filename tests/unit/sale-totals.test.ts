import { describe, expect, it } from "vitest";

import { computeSaleItemTotals, computeSaleTotals, InvalidSaleItemError } from "@/modules/sales/totals";

describe("computeSaleItemTotals", () => {
  it("computes subtotal = quantity * unitPrice, total = subtotal - discount", () => {
    const result = computeSaleItemTotals({
      quantity: 3,
      unitPriceAmount: 150000n, // $1500.00
      discountAmount: 50000n, // $500.00
    });
    expect(result.subtotalAmount).toBe(450000n);
    expect(result.totalAmount).toBe(400000n);
  });

  it("defaults to a full-price total when there is no discount", () => {
    const result = computeSaleItemTotals({ quantity: 2, unitPriceAmount: 100000n, discountAmount: 0n });
    expect(result.subtotalAmount).toBe(200000n);
    expect(result.totalAmount).toBe(200000n);
  });

  it("rejects a zero quantity", () => {
    expect(() =>
      computeSaleItemTotals({ quantity: 0, unitPriceAmount: 100000n, discountAmount: 0n }),
    ).toThrow(InvalidSaleItemError);
  });

  it("rejects a negative quantity", () => {
    expect(() =>
      computeSaleItemTotals({ quantity: -1, unitPriceAmount: 100000n, discountAmount: 0n }),
    ).toThrow(InvalidSaleItemError);
  });

  it("rejects a non-integer quantity", () => {
    expect(() =>
      computeSaleItemTotals({ quantity: 1.5, unitPriceAmount: 100000n, discountAmount: 0n }),
    ).toThrow(InvalidSaleItemError);
  });

  it("rejects a negative unit price", () => {
    expect(() =>
      computeSaleItemTotals({ quantity: 1, unitPriceAmount: -1n, discountAmount: 0n }),
    ).toThrow(InvalidSaleItemError);
  });

  it("rejects a negative discount", () => {
    expect(() =>
      computeSaleItemTotals({ quantity: 1, unitPriceAmount: 100000n, discountAmount: -1n }),
    ).toThrow(InvalidSaleItemError);
  });

  it("rejects a discount larger than the line's own subtotal (never a negative item total)", () => {
    expect(() =>
      computeSaleItemTotals({ quantity: 1, unitPriceAmount: 100000n, discountAmount: 100001n }),
    ).toThrow(InvalidSaleItemError);
  });

  it("allows a discount exactly equal to the subtotal (a free line item)", () => {
    const result = computeSaleItemTotals({ quantity: 1, unitPriceAmount: 100000n, discountAmount: 100000n });
    expect(result.totalAmount).toBe(0n);
  });
});

describe("computeSaleTotals", () => {
  it("sums subtotal/discount/total across every item", () => {
    const totals = computeSaleTotals([
      { subtotalAmount: 100000n, discountAmount: 10000n, totalAmount: 90000n },
      { subtotalAmount: 50000n, discountAmount: 0n, totalAmount: 50000n },
    ]);
    expect(totals.subtotalAmount).toBe(150000n);
    expect(totals.discountTotalAmount).toBe(10000n);
    expect(totals.totalAmount).toBe(140000n);
  });

  it("returns all zeros for an empty item list", () => {
    const totals = computeSaleTotals([]);
    expect(totals.subtotalAmount).toBe(0n);
    expect(totals.discountTotalAmount).toBe(0n);
    expect(totals.totalAmount).toBe(0n);
  });
});
