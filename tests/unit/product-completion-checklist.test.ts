import { describe, expect, it } from "vitest";

import { computeProductCompletionSteps } from "@/modules/products/completion-checklist";

const complete = {
  hasPrice: true,
  hasCategory: true,
  hasSizeGroup: true,
  hasVariants: true,
  hasStock: true,
  hasImages: true,
  isPublished: true,
};

const empty = {
  hasPrice: false,
  hasCategory: false,
  hasSizeGroup: false,
  hasVariants: false,
  hasStock: false,
  hasImages: false,
  isPublished: false,
};

describe("computeProductCompletionSteps", () => {
  it("returns the 6 guided steps in the exact required order", () => {
    const steps = computeProductCompletionSteps(complete);
    expect(steps.map((s) => s.key)).toEqual([
      "basicInfo",
      "categoryAndSize",
      "variants",
      "stock",
      "images",
      "publication",
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Información básica",
      "Categoría y talles",
      "Variantes",
      "Stock",
      "Imágenes",
      "Publicación",
    ]);
  });

  it("marks every step complete for a fully complete, published product", () => {
    const steps = computeProductCompletionSteps(complete);
    expect(steps.every((s) => s.status === "complete")).toBe(true);
    expect(steps.every((s) => s.detail === null)).toBe(true);
  });

  it("marks basicInfo, categoryAndSize and variants as 'attention' when missing — these block publication", () => {
    const steps = computeProductCompletionSteps(empty);
    const attentionKeys = steps.filter((s) => s.status === "attention").map((s) => s.key);
    expect(attentionKeys.sort()).toEqual(["basicInfo", "categoryAndSize", "variants"].sort());
  });

  it("marks stock, images and publication as 'pending' (not 'attention') when missing — these never block publication", () => {
    const steps = computeProductCompletionSteps(empty);
    const pendingKeys = steps.filter((s) => s.status === "pending").map((s) => s.key);
    expect(pendingKeys.sort()).toEqual(["stock", "images", "publication"].sort());
  });

  it("gives each incomplete step a plain-Spanish detail message, never an internal code", () => {
    const steps = computeProductCompletionSteps(empty);
    for (const step of steps) {
      expect(step.detail).not.toBeNull();
      expect(step.detail).not.toMatch(/DRAFT|ACTIVE|sizeGroupId|ProductVariant|blocker/i);
    }
  });

  it("categoryAndSize is complete even without a size group — size group is optional", () => {
    const steps = computeProductCompletionSteps({ ...complete, hasSizeGroup: false });
    const step = steps.find((s) => s.key === "categoryAndSize");
    expect(step?.status).toBe("complete");
  });

  it("tracks each input field independently", () => {
    const steps = computeProductCompletionSteps({ ...complete, hasCategory: false });
    expect(steps.find((s) => s.key === "categoryAndSize")?.status).toBe("attention");
    expect(steps.find((s) => s.key === "basicInfo")?.status).toBe("complete");
  });
});
