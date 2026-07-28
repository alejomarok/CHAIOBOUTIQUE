import { describe, expect, it } from "vitest";

import {
  getEffectivePrice,
  InvalidCompareAtPriceError,
  validateCompareAtPrice,
} from "@/modules/products/pricing";

describe("getEffectivePrice", () => {
  it("prefers the variant price when set", () => {
    expect(getEffectivePrice({ variantPriceAmount: 1000n, productDefaultPriceAmount: 2000n })).toBe(
      1000n,
    );
  });

  it("falls back to the product default when the variant has no override", () => {
    expect(getEffectivePrice({ variantPriceAmount: null, productDefaultPriceAmount: 2000n })).toBe(
      2000n,
    );
  });

  it("returns null when neither is set", () => {
    expect(
      getEffectivePrice({ variantPriceAmount: null, productDefaultPriceAmount: null }),
    ).toBeNull();
  });
});

describe("validateCompareAtPrice", () => {
  it("accepts a compare-at price strictly greater than the effective price", () => {
    expect(() => validateCompareAtPrice(1000n, 1500n)).not.toThrow();
  });

  it("rejects a compare-at price equal to the effective price", () => {
    expect(() => validateCompareAtPrice(1000n, 1000n)).toThrow(InvalidCompareAtPriceError);
  });

  it("rejects a compare-at price lower than the effective price", () => {
    expect(() => validateCompareAtPrice(1000n, 500n)).toThrow(InvalidCompareAtPriceError);
  });

  it("is a no-op when either value is absent", () => {
    expect(() => validateCompareAtPrice(null, 1500n)).not.toThrow();
    expect(() => validateCompareAtPrice(1000n, undefined)).not.toThrow();
  });
});
