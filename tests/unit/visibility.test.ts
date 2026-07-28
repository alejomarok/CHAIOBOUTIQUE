import { describe, expect, it } from "vitest";

import { isPubliclyVisible } from "@/modules/products/visibility";

const baseProduct = { status: "ACTIVE", categoryId: "cat-1", defaultPriceAmount: 1000n };
const activeVariant = { isActive: true, priceAmount: null };

describe("isPubliclyVisible", () => {
  it("is visible when active, categorized, and has a priced active variant", () => {
    expect(isPubliclyVisible(baseProduct, [activeVariant])).toBe(true);
  });

  it("is not visible when status isn't ACTIVE", () => {
    expect(isPubliclyVisible({ ...baseProduct, status: "DRAFT" }, [activeVariant])).toBe(false);
  });

  it("is not visible without a category", () => {
    expect(isPubliclyVisible({ ...baseProduct, categoryId: null }, [activeVariant])).toBe(false);
  });

  it("is not visible without at least one active variant", () => {
    expect(isPubliclyVisible(baseProduct, [{ isActive: false, priceAmount: null }])).toBe(false);
    expect(isPubliclyVisible(baseProduct, [])).toBe(false);
  });

  it("is not visible when an active variant has no effective price", () => {
    expect(isPubliclyVisible({ ...baseProduct, defaultPriceAmount: null }, [activeVariant])).toBe(
      false,
    );
  });

  it("is not visible when an active variant's effective price is zero or negative", () => {
    expect(isPubliclyVisible({ ...baseProduct, defaultPriceAmount: 0n }, [activeVariant])).toBe(
      false,
    );
  });

  it("a variant-level price override is honored", () => {
    expect(
      isPubliclyVisible({ ...baseProduct, defaultPriceAmount: null }, [
        { isActive: true, priceAmount: 500n },
      ]),
    ).toBe(true);
  });

  it("requires every active variant to have a valid price, not just one", () => {
    expect(
      isPubliclyVisible(baseProduct, [activeVariant, { isActive: true, priceAmount: null }]),
    ).toBe(true); // both fall back to the valid product default

    expect(
      isPubliclyVisible({ ...baseProduct, defaultPriceAmount: null }, [
        { isActive: true, priceAmount: 500n },
        { isActive: true, priceAmount: null },
      ]),
    ).toBe(false); // second variant has no price at all
  });
});
