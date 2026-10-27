// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sealSecret, openSecret } from "@/lib/secret-box";
import { contentSecurityPolicy } from "@/lib/security-headers";
import { isPostalCodeCovered } from "@/modules/orders/shipping-coverage";

describe("production security boundaries", () => {
  it("encrypts private links with fresh IVs and rejects tampering and a different purpose", () => {
    const plain = "private-order-token";
    const sealed = sealSecret(plain, "order-access");
    expect(sealed).not.toContain(plain);
    expect(sealSecret(plain, "order-access")).not.toBe(sealed);
    expect(openSecret(sealed, "order-access")).toBe(plain);
    expect(() => openSecret(sealed, "email-outbox")).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("modified content").toString("base64url");
    expect(() => openSecret(parts.join("."), "order-access")).toThrow();
  });
  it("uses nonces without eval in production and confines product media to its storage origin", () => {
    const policy = contentSecurityPolicy("unique-nonce", false, "https://example.supabase.co/path");
    expect(policy).toContain("'nonce-unique-nonce'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("https://example.supabase.co");
    expect(policy).not.toContain("/path");
  });
  it("only allows explicit delivery postal codes, including CPA equivalents", () => {
    expect(isPostalCodeCovered("5856, 5850", "X5856ABC")).toBe(true);
    expect(isPostalCodeCovered("5856", "58560")).toBe(false);
    expect(isPostalCodeCovered("5856", null)).toBe(false);
    expect(isPostalCodeCovered(null, "5856")).toBe(false);
  });
});
