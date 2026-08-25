import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyMercadoPagoWebhookSignature } from "@/modules/payments/mercado-pago/signature-core";

const SECRET = "test-webhook-secret";

function sign(dataId: string, requestId: string, ts: string, secret = SECRET): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${hash}`;
}

describe("verifyMercadoPagoWebhookSignature", () => {
  it("accepts a correctly signed notification", () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const xSignature = sign("123456", "req-1", ts);

    const result = verifyMercadoPagoWebhookSignature({
      xSignature,
      xRequestId: "req-1",
      dataId: "123456",
      secret: SECRET,
    });

    expect(result.valid).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const xSignature = sign("123456", "req-1", ts, "wrong-secret");

    const result = verifyMercadoPagoWebhookSignature({
      xSignature,
      xRequestId: "req-1",
      dataId: "123456",
      secret: SECRET,
    });

    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe("SignatureMismatch");
  });

  it("rejects a signature computed for a different dataId", () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const xSignature = sign("999999", "req-1", ts);

    const result = verifyMercadoPagoWebhookSignature({
      xSignature,
      xRequestId: "req-1",
      dataId: "123456",
      secret: SECRET,
    });

    expect(result.valid).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const result = verifyMercadoPagoWebhookSignature({
      xSignature: null,
      xRequestId: "req-1",
      dataId: "123456",
      secret: SECRET,
    });

    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe("MissingSignatureHeader");
  });

  it("rejects a malformed signature header", () => {
    const result = verifyMercadoPagoWebhookSignature({
      xSignature: "not-a-valid-header",
      xRequestId: "req-1",
      dataId: "123456",
      secret: SECRET,
    });

    expect(result.valid).toBe(false);
  });

  it("never mutates any state — pure verification only", () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const xSignature = sign("123456", "req-1", ts);

    const first = verifyMercadoPagoWebhookSignature({
      xSignature,
      xRequestId: "req-1",
      dataId: "123456",
      secret: SECRET,
    });
    const second = verifyMercadoPagoWebhookSignature({
      xSignature,
      xRequestId: "req-1",
      dataId: "123456",
      secret: SECRET,
    });

    expect(first).toEqual(second);
  });
});
