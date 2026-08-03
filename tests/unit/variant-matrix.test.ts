import { describe, expect, it } from "vitest";

import {
  findDuplicateCombinationsInBatch,
  generateVariantMatrix,
  isDuplicateCombination,
} from "@/modules/products/variant-matrix";

describe("generateVariantMatrix", () => {
  it("returns a single default variant when there are no axes", () => {
    expect(generateVariantMatrix([], [])).toEqual([{ sizeOptionId: null, colorId: null }]);
  });

  it("returns one variant per size when only sizes are given", () => {
    expect(generateVariantMatrix(["s", "m"], [])).toEqual([
      { sizeOptionId: "s", colorId: null },
      { sizeOptionId: "m", colorId: null },
    ]);
  });

  it("returns one variant per color when only colors are given", () => {
    expect(generateVariantMatrix([], ["black", "white"])).toEqual([
      { sizeOptionId: null, colorId: "black" },
      { sizeOptionId: null, colorId: "white" },
    ]);
  });

  it("returns the cartesian product when both axes are given", () => {
    expect(generateVariantMatrix(["s", "m"], ["black", "white"])).toEqual([
      { sizeOptionId: "s", colorId: "black" },
      { sizeOptionId: "s", colorId: "white" },
      { sizeOptionId: "m", colorId: "black" },
      { sizeOptionId: "m", colorId: "white" },
    ]);
  });
});

describe("isDuplicateCombination", () => {
  it("detects an exact match", () => {
    const existing = [{ sizeOptionId: "s", colorId: "black" }];
    expect(isDuplicateCombination(existing, { sizeOptionId: "s", colorId: "black" })).toBe(true);
    expect(isDuplicateCombination(existing, { sizeOptionId: "m", colorId: "black" })).toBe(false);
  });

  it("detects a duplicate default (no-axis) variant", () => {
    const existing = [{ sizeOptionId: null, colorId: null }];
    expect(isDuplicateCombination(existing, { sizeOptionId: null, colorId: null })).toBe(true);
  });
});

describe("findDuplicateCombinationsInBatch", () => {
  it("flags a proposed combination that collides with an existing variant", () => {
    const existing = [{ sizeOptionId: "s", colorId: "black" }];
    const proposed = [
      { sizeOptionId: "s", colorId: "black" },
      { sizeOptionId: "m", colorId: "black" },
    ];
    expect(findDuplicateCombinationsInBatch(existing, proposed)).toEqual([
      { sizeOptionId: "s", colorId: "black" },
    ]);
  });

  it("flags two identical combinations within the same proposed batch", () => {
    const proposed = [
      { sizeOptionId: "s", colorId: null },
      { sizeOptionId: "s", colorId: null },
    ];
    expect(findDuplicateCombinationsInBatch([], proposed)).toHaveLength(1);
  });

  it("returns no duplicates for a clean batch", () => {
    const proposed = generateVariantMatrix(["s", "m"], ["black", "white"]);
    expect(findDuplicateCombinationsInBatch([], proposed)).toHaveLength(0);
  });
});
