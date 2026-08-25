import { describe, expect, it } from "vitest";

import { buildCandidateOrderCode } from "@/modules/orders/record-code";

describe("buildCandidateOrderCode", () => {
  it("starts with the PED- prefix", () => {
    expect(buildCandidateOrderCode()).toMatch(/^PED-[0-9A-Z]+$/);
  });

  it("produces different codes across many calls (collision-retry still needed, but rare)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => buildCandidateOrderCode()));
    expect(codes.size).toBeGreaterThan(40);
  });
});
