// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalStorefrontUrl } from "@/lib/canonical-storefront";
describe("canonical storefront", () => {
  it("moves production deployment pages to the fixed official origin, preserving path and query", () => {
    const target = canonicalStorefrontUrl(
      new URL("https://deployment.vercel.app/login?redirectTo=%2Fadmin"),
      "production",
      "https://shop.example.com",
    );
    expect(target?.toString()).toBe("https://shop.example.com/login?redirectTo=%2Fadmin");
  });
  it("leaves the official host, previews and localhost unchanged", () => {
    for (const [url, environment] of [
      ["https://shop.vercel.app/login", "production"],
      ["https://preview.vercel.app/login", "preview"],
      ["http://localhost:3000", "production"],
    ])
      expect(
        canonicalStorefrontUrl(new URL(url), environment, "https://shop.vercel.app"),
      ).toBeNull();
  });
  it("never trusts an insecure canonical target", () => {
    expect(
      canonicalStorefrontUrl(
        new URL("https://deployment.vercel.app"),
        "production",
        "http://evil.example",
      ),
    ).toBeNull();
  });
});
