import { describe, expect, it } from "vitest";

import { getVisibilityBlockers, isPubliclyVisible } from "@/modules/products/visibility";

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

describe("getVisibilityBlockers", () => {
  it("returns an empty list for a fully publishable product", () => {
    expect(getVisibilityBlockers(baseProduct, [activeVariant])).toEqual([]);
  });

  it("never includes an image-related blocker — having no image is not a condition", () => {
    const blockers = getVisibilityBlockers(baseProduct, [activeVariant]);
    expect(blockers.every((b) => !b.message.toLowerCase().includes("imagen"))).toBe(true);
  });

  it("reports NOT_ACTIVE_STATUS when status isn't ACTIVE", () => {
    const blockers = getVisibilityBlockers({ ...baseProduct, status: "DRAFT" }, [activeVariant]);
    expect(blockers.map((b) => b.code)).toContain("NOT_ACTIVE_STATUS");
  });

  it("reports NO_CATEGORY when there is no category", () => {
    const blockers = getVisibilityBlockers({ ...baseProduct, categoryId: null }, [activeVariant]);
    expect(blockers.map((b) => b.code)).toContain("NO_CATEGORY");
  });

  it("reports NO_ACTIVE_VARIANTS when there are no active variants", () => {
    expect(getVisibilityBlockers(baseProduct, []).map((b) => b.code)).toContain(
      "NO_ACTIVE_VARIANTS",
    );
  });

  it("reports VARIANT_MISSING_PRICE when an active variant has no valid effective price", () => {
    const blockers = getVisibilityBlockers({ ...baseProduct, defaultPriceAmount: null }, [
      activeVariant,
    ]);
    expect(blockers.map((b) => b.code)).toContain("VARIANT_MISSING_PRICE");
  });

  it("can report multiple simultaneous blockers, not just the first one found", () => {
    const blockers = getVisibilityBlockers(
      { status: "DRAFT", categoryId: null, defaultPriceAmount: null },
      [],
    );
    expect(blockers.map((b) => b.code).sort()).toEqual(
      ["NOT_ACTIVE_STATUS", "NO_ACTIVE_VARIANTS", "NO_CATEGORY"].sort(),
    );
  });

  it("agrees with isPubliclyVisible: blockers is empty exactly when isPubliclyVisible is true", () => {
    const cases: [typeof baseProduct, typeof activeVariant[]][] = [
      [baseProduct, [activeVariant]],
      [{ ...baseProduct, status: "ARCHIVED" }, [activeVariant]],
      [baseProduct, []],
    ];
    for (const [product, variants] of cases) {
      expect(getVisibilityBlockers(product, variants).length === 0).toBe(
        isPubliclyVisible(product, variants),
      );
    }
  });
});
