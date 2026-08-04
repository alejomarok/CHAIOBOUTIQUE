import { describe, expect, it } from "vitest";

import { diceCoefficient, findSimilarSizeGroups, looksSimilar } from "@/modules/attributes/similarity";

describe("looksSimilar", () => {
  it("flags PANTALONES vs PANTS via shared prefix", () => {
    expect(looksSimilar("pantalones", "pants")).toBe(true);
  });

  it("flags identical strings", () => {
    expect(looksSimilar("calzado", "calzado")).toBe(true);
  });

  it("does not flag clearly unrelated strings", () => {
    expect(looksSimilar("remeras", "calzado")).toBe(false);
  });

  it("does not flag short, coincidentally-overlapping strings below the threshold", () => {
    expect(looksSimilar("s", "m")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(looksSimilar("", "pants")).toBe(false);
    expect(looksSimilar("pants", "")).toBe(false);
  });
});

describe("diceCoefficient", () => {
  it("is 1 for identical strings", () => {
    expect(diceCoefficient("pants", "pants")).toBe(1);
  });

  it("is 0 for strings with no shared bigrams", () => {
    expect(diceCoefficient("ab", "xy")).toBe(0);
  });

  it("is symmetric", () => {
    expect(diceCoefficient("pantalones", "pants")).toBeCloseTo(
      diceCoefficient("pants", "pantalones"),
    );
  });
});

describe("findSimilarSizeGroups", () => {
  it("flags an existing group whose name normalizes close to the candidate's code", () => {
    const matches = findSimilarSizeGroups(
      { code: "PANTS", name: "Pants" },
      [
        { code: "PANTALONES", name: "Pantalones" },
        { code: "FOOTWEAR", name: "Calzado" },
      ],
    );
    expect(matches).toEqual([{ code: "PANTALONES", name: "Pantalones" }]);
  });

  it("returns an empty array when nothing is similar", () => {
    const matches = findSimilarSizeGroups(
      { code: "ACCESSORIES", name: "Accesorios" },
      [
        { code: "PANTALONES", name: "Pantalones" },
        { code: "FOOTWEAR", name: "Calzado" },
      ],
    );
    expect(matches).toEqual([]);
  });

  it("never flags a group against itself when it's not in the existing list", () => {
    const matches = findSimilarSizeGroups({ code: "PANTS", name: "Pants" }, []);
    expect(matches).toEqual([]);
  });
});
