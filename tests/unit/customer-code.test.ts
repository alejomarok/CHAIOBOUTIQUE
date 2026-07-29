import { describe, expect, it } from "vitest";

import { buildCandidateCustomerCode } from "@/modules/customers/customer-code";

describe("buildCandidateCustomerCode", () => {
  it("starts with the C- prefix", () => {
    expect(buildCandidateCustomerCode()).toMatch(/^C-[0-9A-Z]+$/);
  });

  it("produces different codes across many calls (collision-retry still needed, but rare)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => buildCandidateCustomerCode()));
    // Not a strict guarantee (two calls in the same millisecond with the
    // same random suffix could theoretically collide) — but 50 calls
    // producing fewer than 50 unique codes would indicate something
    // structurally wrong (e.g. a fixed/non-random component).
    expect(codes.size).toBeGreaterThan(40);
  });
});
