import { describe, expect, it, vi } from "vitest";

// SupabaseStorageProvider builds its client lazily, per-call, from `env` —
// this stubs env directly rather than mutating process.env, so the missing-
// config error path is deterministic regardless of what's actually in this
// machine's .env.
let envStub: { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string } = {};
vi.mock("@/lib/env", () => ({
  get env() {
    return envStub;
  },
}));

const { SupabaseStorageProvider } = await import("@/modules/storage/supabase-provider");

describe("SupabaseStorageProvider — unconfigured storage", () => {
  it("throws a clear, safe error (no secret values) when SUPABASE_URL/SUPABASE_SECRET_KEY are missing", async () => {
    envStub = {};
    const provider = new SupabaseStorageProvider();

    await expect(
      provider.upload({
        bucket: "product-images",
        path: "products/x.jpg",
        file: Buffer.from("fake"),
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow("Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  });

  it("throws the same clear error from getPublicUrl when unconfigured", () => {
    envStub = {};
    const provider = new SupabaseStorageProvider();

    expect(() => provider.getPublicUrl("product-images", "products/x.jpg")).toThrow(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  });

  it("throws when only one of the two required values is set", async () => {
    envStub = { SUPABASE_URL: "https://example.supabase.co" };
    const provider = new SupabaseStorageProvider();

    await expect(provider.delete("product-images", "products/x.jpg")).rejects.toThrow(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  });
});
