// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env-core", () => ({
  env: { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "fake-test-key" },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("global email availability", () => {
  it("blocks invalid provider credentials and shares the check across requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ name: "validation_error" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { isEmailDeliveryAvailable } = await import("@/modules/email/availability-core");
    expect(await isEmailDeliveryAvailable()).toBe(false);
    expect(await isEmailDeliveryAvailable()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("accepts sending-only keys without requiring domain-administration access", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ name: "restricted_api_key" }),
        }),
    );
    const { isEmailDeliveryAvailable } = await import("@/modules/email/availability-core");
    expect(await isEmailDeliveryAvailable()).toBe(true);
  });
  it("rejects inactive or suspended keys rather than allowing every 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 403,
          json: async () => ({ name: "suspended_api_key" }),
        }),
    );
    const { isEmailDeliveryAvailable } = await import("@/modules/email/availability-core");
    expect(await isEmailDeliveryAvailable()).toBe(false);
  });
  it("fails safely when the provider cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const { isEmailDeliveryAvailable } = await import("@/modules/email/availability-core");
    expect(await isEmailDeliveryAvailable()).toBe(false);
  });
});
