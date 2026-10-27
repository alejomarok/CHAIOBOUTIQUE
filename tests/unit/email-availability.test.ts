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
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);
    const { isEmailDeliveryAvailable } = await import("@/modules/email/availability-core");
    expect(await isEmailDeliveryAvailable()).toBe(false);
    expect(await isEmailDeliveryAvailable()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("accepts sending-only keys without requiring domain-administration access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { isEmailDeliveryAvailable } = await import("@/modules/email/availability-core");
    expect(await isEmailDeliveryAvailable()).toBe(true);
  });
  it("fails safely when the provider cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const { isEmailDeliveryAvailable } = await import("@/modules/email/availability-core");
    expect(await isEmailDeliveryAvailable()).toBe(false);
  });
});
