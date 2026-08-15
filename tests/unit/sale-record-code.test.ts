import { describe, expect, it } from "vitest";

import { buildCandidateSaleCode } from "@/modules/sales/record-code";

describe("buildCandidateSaleCode", () => {
  it("starts with the VEN- prefix", () => {
    expect(buildCandidateSaleCode()).toMatch(/^VEN-[0-9A-Z]+$/);
  });

  it("produces different codes across many calls (collision-retry still needed, but rare)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => buildCandidateSaleCode()));
    expect(codes.size).toBeGreaterThan(40);
  });
});
