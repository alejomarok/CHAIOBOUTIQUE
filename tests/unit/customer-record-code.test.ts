import { describe, expect, it } from "vitest";

import { buildCandidateCustomerRecordCode } from "@/modules/customers/record-code";

describe("buildCandidateCustomerRecordCode", () => {
  it("starts with the CLI- prefix", () => {
    expect(buildCandidateCustomerRecordCode()).toMatch(/^CLI-[0-9A-Z]+$/);
  });

  it("produces different codes across many calls (collision-retry still needed, but rare)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => buildCandidateCustomerRecordCode()));
    expect(codes.size).toBeGreaterThan(40);
  });
});
