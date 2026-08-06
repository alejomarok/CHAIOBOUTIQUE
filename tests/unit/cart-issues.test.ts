import { describe, expect, it } from "vitest";

import { computeCartItemIssues, isBlockingIssue } from "@/modules/cart/issues";

const BASE = {
  variantIsActive: true,
  productPurchasable: true,
  currentEffectivePrice: 1000n,
  observedUnitPriceAmount: 1000n,
  availableStock: 5,
  quantity: 1,
};

describe("computeCartItemIssues", () => {
  it("returns no issues for a fully healthy item", () => {
    expect(computeCartItemIssues(BASE)).toEqual([]);
  });

  it("reports VARIANT_INACTIVE when the variant is inactive, never also PRODUCT_INACTIVE", () => {
    const issues = computeCartItemIssues({ ...BASE, variantIsActive: false, productPurchasable: false });
    expect(issues.map((i) => i.code)).toEqual(["VARIANT_INACTIVE"]);
  });

  it("reports PRODUCT_INACTIVE when the variant is active but the product isn't purchasable", () => {
    const issues = computeCartItemIssues({ ...BASE, productPurchasable: false });
    expect(issues.map((i) => i.code)).toEqual(["PRODUCT_INACTIVE"]);
  });

  it("reports PRICE_CHANGED when the current price differs from the observed one", () => {
    const issues = computeCartItemIssues({ ...BASE, currentEffectivePrice: 1500n });
    expect(issues.map((i) => i.code)).toEqual(["PRICE_CHANGED"]);
  });

  it("never reports PRICE_CHANGED when currentEffectivePrice cannot be resolved (null)", () => {
    const issues = computeCartItemIssues({ ...BASE, currentEffectivePrice: null });
    expect(issues.map((i) => i.code)).not.toContain("PRICE_CHANGED");
  });

  it("reports INSUFFICIENT_STOCK when available stock is below the requested quantity", () => {
    const issues = computeCartItemIssues({ ...BASE, availableStock: 0, quantity: 2 });
    expect(issues.map((i) => i.code)).toEqual(["INSUFFICIENT_STOCK"]);
    expect(issues[0].message).toContain("no tiene stock");
  });

  it("gives a specific remaining-quantity message when some stock remains but not enough", () => {
    const issues = computeCartItemIssues({ ...BASE, availableStock: 1, quantity: 3 });
    expect(issues[0].message).toContain("1");
  });

  it("never reports INSUFFICIENT_STOCK when stock exactly matches the requested quantity", () => {
    const issues = computeCartItemIssues({ ...BASE, availableStock: 2, quantity: 2 });
    expect(issues.map((i) => i.code)).not.toContain("INSUFFICIENT_STOCK");
  });

  it("can report multiple simultaneous issues", () => {
    const issues = computeCartItemIssues({
      ...BASE,
      currentEffectivePrice: 1500n,
      availableStock: 0,
      quantity: 1,
    });
    expect(issues.map((i) => i.code).sort()).toEqual(["INSUFFICIENT_STOCK", "PRICE_CHANGED"].sort());
  });
});

describe("isBlockingIssue", () => {
  it("treats PRICE_CHANGED as non-blocking", () => {
    expect(isBlockingIssue({ code: "PRICE_CHANGED", message: "" })).toBe(false);
  });

  it("treats every other issue code as blocking", () => {
    expect(isBlockingIssue({ code: "PRODUCT_INACTIVE", message: "" })).toBe(true);
    expect(isBlockingIssue({ code: "VARIANT_INACTIVE", message: "" })).toBe(true);
    expect(isBlockingIssue({ code: "VARIANT_REMOVED", message: "" })).toBe(true);
    expect(isBlockingIssue({ code: "INSUFFICIENT_STOCK", message: "" })).toBe(true);
  });
});
