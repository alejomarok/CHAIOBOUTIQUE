import { describe, expect, it } from "vitest";

import { generateOrderAccessToken, hashOrderAccessToken } from "@/modules/orders/access-token";

describe("generateOrderAccessToken", () => {
  it("produces a 256-bit (32-byte) base64url token", () => {
    const token = generateOrderAccessToken();
    // base64url of 32 bytes is 43 characters (no padding).
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces different tokens across many calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOrderAccessToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("hashOrderAccessToken", () => {
  it("is deterministic — the same token always hashes to the same value", () => {
    const token = generateOrderAccessToken();
    expect(hashOrderAccessToken(token)).toBe(hashOrderAccessToken(token));
  });

  it("produces different hashes for different tokens", () => {
    const a = hashOrderAccessToken(generateOrderAccessToken());
    const b = hashOrderAccessToken(generateOrderAccessToken());
    expect(a).not.toBe(b);
  });

  it("never returns the raw token itself (a real hash transformation happened)", () => {
    const token = generateOrderAccessToken();
    expect(hashOrderAccessToken(token)).not.toBe(token);
  });

  it("produces a 64-character lowercase hex SHA-256 digest", () => {
    const hash = hashOrderAccessToken(generateOrderAccessToken());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
