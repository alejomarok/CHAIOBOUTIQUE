// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({
  RESEND_API_KEY: "test-only-key",
  EMAIL_FROM: "sender@example.com",
  EMAIL_REPLY_TO: "reply@example.com",
  RESEND_TEST_RECIPIENT: undefined as string | undefined,
}));
vi.mock("@/lib/env-core", () => ({ env: config }));
import { ResendEmailProvider } from "@/modules/email/resend-provider";
const input = {
  to: "recipient@example.com",
  subject: "Test",
  text: "Private message",
  messageId: "<message@example.com>",
};
beforeEach(() => {
  config.RESEND_TEST_RECIPIENT = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Resend delivery", () => {
  it("sends through the authenticated provider and deduplicates queued retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: "email-id" }) });
    vi.stubGlobal("fetch", fetchMock);
    await new ResendEmailProvider().send(input);
    await new ResendEmailProvider().send(input);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(request.body)).toMatchObject({
      from: config.EMAIL_FROM,
      to: [input.to],
      reply_to: config.EMAIL_REPLY_TO,
    });
    expect(request.headers["Idempotency-Key"]).toBe(
      fetchMock.mock.calls[1][1].headers["Idempotency-Key"],
    );
  });
  it("propagates a delivery failure without leaking the provider response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 403,
          json: async () => ({ message: "private recipient details" }),
        }),
    );
    await expect(new ResendEmailProvider().send(input)).rejects.toThrow(
      "No se pudo enviar el correo electrónico.",
    );
  });
  it("blocks other recipients in temporary owner-only mode", async () => {
    config.RESEND_TEST_RECIPIENT = "owner@example.com";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new ResendEmailProvider().send(input)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
