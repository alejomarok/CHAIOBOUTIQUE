import { describe, expect, it } from "vitest";

import { computeProductCompletionSteps } from "@/modules/products/completion-checklist";

const complete = {
  hasCategory: true,
  hasSizeGroup: true,
  hasPrice: true,
  hasVariants: true,
  hasStock: true,
  hasImages: true,
  isPublished: true,
};

describe("computeProductCompletionSteps", () => {
  it("marks every step done for a fully complete, published product", () => {
    const steps = computeProductCompletionSteps(complete);
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it("marks category, price, variants and publication as required (not optional)", () => {
    const steps = computeProductCompletionSteps(complete);
    const requiredKeys = steps.filter((s) => !s.optional).map((s) => s.key);
    expect(requiredKeys.sort()).toEqual(["category", "price", "published", "variants"].sort());
  });

  it("marks size group, stock and images as optional", () => {
    const steps = computeProductCompletionSteps(complete);
    const optionalKeys = steps.filter((s) => s.optional).map((s) => s.key);
    expect(optionalKeys.sort()).toEqual(["images", "sizeGroup", "stock"].sort());
  });

  it("reflects a freshly created, empty product as entirely pending", () => {
    const steps = computeProductCompletionSteps({
      hasCategory: false,
      hasSizeGroup: false,
      hasPrice: false,
      hasVariants: false,
      hasStock: false,
      hasImages: false,
      isPublished: false,
    });
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("tracks each input field independently", () => {
    const steps = computeProductCompletionSteps({ ...complete, hasCategory: false });
    const category = steps.find((s) => s.key === "category");
    const price = steps.find((s) => s.key === "price");
    expect(category?.done).toBe(false);
    expect(price?.done).toBe(true);
  });
});
