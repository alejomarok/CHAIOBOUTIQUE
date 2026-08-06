import { describe, expect, it } from "vitest";

import {
  findSelectedVariant,
  isColorAvailable,
  isSizeAvailable,
  listColorOptions,
  listSizeOptions,
  pickDefaultVariant,
  type SelectableVariant,
} from "@/modules/products/variant-selection";

const SIZED_AND_COLORED: SelectableVariant[] = [
  {
    id: "v-s-red",
    sizeOptionId: "size-s",
    sizeName: "S",
    sizeSortOrder: 1,
    colorId: "color-red",
    colorName: "Rojo",
    stockStatus: "IN_STOCK",
  },
  {
    id: "v-m-red",
    sizeOptionId: "size-m",
    sizeName: "M",
    sizeSortOrder: 2,
    colorId: "color-red",
    colorName: "Rojo",
    stockStatus: "OUT_OF_STOCK",
  },
  {
    id: "v-s-blue",
    sizeOptionId: "size-s",
    sizeName: "S",
    sizeSortOrder: 1,
    colorId: "color-blue",
    colorName: "Azul",
    stockStatus: "IN_STOCK",
  },
];

const AXIS_LESS: SelectableVariant[] = [
  {
    id: "v-only",
    sizeOptionId: null,
    sizeName: null,
    sizeSortOrder: null,
    colorId: null,
    colorName: null,
    stockStatus: "IN_STOCK",
  },
];

describe("listSizeOptions", () => {
  it("dedupes and orders by sortOrder, never alphabetically", () => {
    const withOutOfOrderNames: SelectableVariant[] = [
      { ...SIZED_AND_COLORED[1], sizeOptionId: "size-10", sizeName: "10", sizeSortOrder: 2 },
      { ...SIZED_AND_COLORED[0], sizeOptionId: "size-9", sizeName: "9", sizeSortOrder: 1 },
    ];
    expect(listSizeOptions(withOutOfOrderNames).map((s) => s.name)).toEqual(["9", "10"]);
  });

  it("dedupes repeated sizes across colors", () => {
    expect(listSizeOptions(SIZED_AND_COLORED).map((s) => s.name)).toEqual(["S", "M"]);
  });

  it("returns an empty list for an axis-less product", () => {
    expect(listSizeOptions(AXIS_LESS)).toEqual([]);
  });
});

describe("listColorOptions", () => {
  it("dedupes colors across sizes", () => {
    expect(listColorOptions(SIZED_AND_COLORED).map((c) => c.name)).toEqual(["Rojo", "Azul"]);
  });

  it("returns an empty list for an axis-less product", () => {
    expect(listColorOptions(AXIS_LESS)).toEqual([]);
  });
});

describe("isSizeAvailable / isColorAvailable", () => {
  it("a size is available for a color when a matching active variant exists", () => {
    expect(isSizeAvailable(SIZED_AND_COLORED, "size-s", "color-red")).toBe(true);
    expect(isSizeAvailable(SIZED_AND_COLORED, "size-s", "color-blue")).toBe(true);
  });

  it("a size is unavailable for a color when no variant covers that exact pairing", () => {
    // M only exists in red, never in blue.
    expect(isSizeAvailable(SIZED_AND_COLORED, "size-m", "color-blue")).toBe(false);
  });

  it("with no color selected yet, any size that exists in any color is available", () => {
    expect(isSizeAvailable(SIZED_AND_COLORED, "size-m", null)).toBe(true);
  });

  it("is symmetric for colors relative to a selected size", () => {
    expect(isColorAvailable(SIZED_AND_COLORED, "color-blue", "size-s")).toBe(true);
    expect(isColorAvailable(SIZED_AND_COLORED, "color-blue", "size-m")).toBe(false);
    expect(isColorAvailable(SIZED_AND_COLORED, "color-blue", null)).toBe(true);
  });
});

describe("findSelectedVariant", () => {
  it("finds the concrete variant for a valid combination", () => {
    expect(findSelectedVariant(SIZED_AND_COLORED, "size-s", "color-blue")?.id).toBe("v-s-blue");
  });

  it("returns undefined for a combination with no corresponding variant — required behavior: never a purchasable state without a concrete variant", () => {
    expect(findSelectedVariant(SIZED_AND_COLORED, "size-m", "color-blue")).toBeUndefined();
  });

  it("finds the single variant of an axis-less product when both selections are null", () => {
    expect(findSelectedVariant(AXIS_LESS, null, null)?.id).toBe("v-only");
  });
});

describe("pickDefaultVariant", () => {
  it("prefers the first in-stock variant", () => {
    expect(pickDefaultVariant(SIZED_AND_COLORED)?.id).toBe("v-s-red");
  });

  it("falls back to the first variant when every variant is out of stock", () => {
    const allOut = SIZED_AND_COLORED.map((v) => ({ ...v, stockStatus: "OUT_OF_STOCK" as const }));
    expect(pickDefaultVariant(allOut)?.id).toBe(allOut[0].id);
  });

  it("returns the single variant for an axis-less product", () => {
    expect(pickDefaultVariant(AXIS_LESS)?.id).toBe("v-only");
  });
});
