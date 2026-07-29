import { describe, expect, it } from "vitest";

import { isSafeInternalPath } from "@/lib/safe-redirect";

describe("isSafeInternalPath", () => {
  it("accepts a plain internal path", () => {
    expect(isSafeInternalPath("/admin")).toBe(true);
    expect(isSafeInternalPath("/admin/products")).toBe(true);
    expect(isSafeInternalPath("/account/profile?tab=security")).toBe(true);
  });

  it("rejects an absolute external URL", () => {
    expect(isSafeInternalPath("https://evil.com")).toBe(false);
    expect(isSafeInternalPath("http://evil.com/admin")).toBe(false);
  });

  it("rejects a protocol-relative URL (browsers treat // as external)", () => {
    expect(isSafeInternalPath("//evil.com")).toBe(false);
  });

  it("rejects a backslash variant some browsers normalize to protocol-relative", () => {
    expect(isSafeInternalPath("/\\evil.com")).toBe(false);
  });

  it("rejects a javascript: URL", () => {
    expect(isSafeInternalPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects a path with no leading slash", () => {
    expect(isSafeInternalPath("admin")).toBe(false);
    expect(isSafeInternalPath("evil.com/admin")).toBe(false);
  });

  it("rejects null, undefined, and empty string", () => {
    expect(isSafeInternalPath(null)).toBe(false);
    expect(isSafeInternalPath(undefined)).toBe(false);
    expect(isSafeInternalPath("")).toBe(false);
  });
});
