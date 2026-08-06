import { describe, expect, it } from "vitest";

import { computeMergedQuantity } from "@/modules/cart/merge-policy";

describe("computeMergedQuantity", () => {
  it("sums the two quantities when nothing else constrains them", () => {
    expect(
      computeMergedQuantity({
        existingQuantity: 2,
        incomingQuantity: 3,
        availableStock: 100,
        maxQuantity: 20,
      }),
    ).toBe(5);
  });

  it("creates a new line as-is when there is no existing quantity", () => {
    expect(
      computeMergedQuantity({
        existingQuantity: 0,
        incomingQuantity: 4,
        availableStock: 100,
        maxQuantity: 20,
      }),
    ).toBe(4);
  });

  it("caps the combined quantity at maxQuantity", () => {
    expect(
      computeMergedQuantity({
        existingQuantity: 15,
        incomingQuantity: 10,
        availableStock: 100,
        maxQuantity: 20,
      }),
    ).toBe(20);
  });

  it("additionally caps by available stock when stock is positive and lower than the limit-capped quantity", () => {
    expect(
      computeMergedQuantity({
        existingQuantity: 2,
        incomingQuantity: 5,
        availableStock: 3,
        maxQuantity: 20,
      }),
    ).toBe(3);
  });

  it("never applies the stock cap when stock is exactly zero — the item is carried over at the limit-capped quantity instead of being silently zeroed", () => {
    expect(
      computeMergedQuantity({
        existingQuantity: 1,
        incomingQuantity: 1,
        availableStock: 0,
        maxQuantity: 20,
      }),
    ).toBe(2);
  });

  it("the quantity limit still applies even when stock is zero", () => {
    expect(
      computeMergedQuantity({
        existingQuantity: 15,
        incomingQuantity: 10,
        availableStock: 0,
        maxQuantity: 20,
      }),
    ).toBe(20);
  });

  it("is idempotent when applied to its own previous result plus zero incoming (repeated merge simulation)", () => {
    const first = computeMergedQuantity({
      existingQuantity: 0,
      incomingQuantity: 5,
      availableStock: 100,
      maxQuantity: 20,
    });
    // A second merge attempt for the same anonymous cart never actually
    // re-runs this (the anonymous cart is no longer ACTIVE — see
    // modules/cart/service.ts) — this asserts the arithmetic itself is
    // stable if it somehow were re-applied with nothing new incoming.
    const second = computeMergedQuantity({
      existingQuantity: first,
      incomingQuantity: 0,
      availableStock: 100,
      maxQuantity: 20,
    });
    expect(second).toBe(first);
  });
});
