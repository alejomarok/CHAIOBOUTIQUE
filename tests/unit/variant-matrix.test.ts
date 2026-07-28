import { describe, expect, it } from "vitest";

import {
  findDuplicateCombinationsInBatch,
  generateVariantMatrix,
  isDuplicateCombination,
} from "@/modules/products/variant-matrix";

describe("generateVariantMatrix", () => {
  it("returns a single default variant when there are no axes", () => {
    expect(generateVariantMatrix([], [])).toEqual([{ sizeId: null, colorId: null }]);
  });

  it("returns one variant per size when only sizes are given", () => {
    expect(generateVariantMatrix(["s", "m"], [])).toEqual([
      { sizeId: "s", colorId: null },
      { sizeId: "m", colorId: null },
    ]);
  });

  it("returns one variant per color when only colors are given", () => {
    expect(generateVariantMatrix([], ["black", "white"])).toEqual([
      { sizeId: null, colorId: "black" },
      { sizeId: null, colorId: "white" },
    ]);
  });

  it("returns the cartesian product when both axes are given", () => {
    expect(generateVariantMatrix(["s", "m"], ["black", "white"])).toEqual([
      { sizeId: "s", colorId: "black" },
      { sizeId: "s", colorId: "white" },
      { sizeId: "m", colorId: "black" },
      { sizeId: "m", colorId: "white" },
    ]);
  });
});

describe("isDuplicateCombination", () => {
  it("detects an exact match", () => {
    const existing = [{ sizeId: "s", colorId: "black" }];
    expect(isDuplicateCombination(existing, { sizeId: "s", colorId: "black" })).toBe(true);
    expect(isDuplicateCombination(existing, { sizeId: "m", colorId: "black" })).toBe(false);
  });

  it("detects a duplicate default (no-axis) variant", () => {
    const existing = [{ sizeId: null, colorId: null }];
    expect(isDuplicateCombination(existing, { sizeId: null, colorId: null })).toBe(true);
  });
});

describe("findDuplicateCombinationsInBatch", () => {
  it("flags a proposed combination that collides with an existing variant", () => {
    const existing = [{ sizeId: "s", colorId: "black" }];
    const proposed = [
      { sizeId: "s", colorId: "black" },
      { sizeId: "m", colorId: "black" },
    ];
    expect(findDuplicateCombinationsInBatch(existing, proposed)).toEqual([
      { sizeId: "s", colorId: "black" },
    ]);
  });

  it("flags two identical combinations within the same proposed batch", () => {
    const proposed = [
      { sizeId: "s", colorId: null },
      { sizeId: "s", colorId: null },
    ];
    expect(findDuplicateCombinationsInBatch([], proposed)).toHaveLength(1);
  });

  it("returns no duplicates for a clean batch", () => {
    const proposed = generateVariantMatrix(["s", "m"], ["black", "white"]);
    expect(findDuplicateCombinationsInBatch([], proposed)).toHaveLength(0);
  });
});
