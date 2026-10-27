// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});
describe("production environment rejects unsafe operation", () => {
  function production() {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-more-than-thirty-two-characters");
    vi.stubEnv("DATA_ENCRYPTION_KEY", "11".repeat(32));
    vi.stubEnv("E2E_TEST_MODE", "false");
    vi.stubEnv("BETTER_AUTH_URL", "https://store.example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://store.example.com");
  }
  it("forbids fake payment/storage providers even with valid secrets", async () => {
    production();
    vi.stubEnv("E2E_TEST_MODE", "true");
    await expect(import("@/lib/env-core")).rejects.toThrow("Invalid environment variables");
  });
  it("requires a separate persistent encryption key", async () => {
    production();
    vi.stubEnv("DATA_ENCRYPTION_KEY", "");
    await expect(import("@/lib/env-core")).rejects.toThrow("Invalid environment variables");
  });
  it("rejects a public production origin without HTTPS", async () => {
    production();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://store.example.com");
    await expect(import("@/lib/env-core")).rejects.toThrow("Invalid environment variables");
  });
  it("rejects localhost on Vercel production", async () => {
    production();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    await expect(import("@/lib/env-core")).rejects.toThrow("Invalid environment variables");
  });
  it("rejects mismatched authentication and storefront domains", async () => {
    production();
    vi.stubEnv("BETTER_AUTH_URL", "https://other.example.com");
    await expect(import("@/lib/env-core")).rejects.toThrow("Invalid environment variables");
  });
});
