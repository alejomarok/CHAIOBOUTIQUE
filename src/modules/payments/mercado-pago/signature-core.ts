import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";

// Uses the official SDK's own WebhookSignatureValidator (verified present
// in the actually-installed `mercadopago` package — see this file's
// counterpart research in the final report) rather than hand-rolling HMAC:
// it already implements the documented manifest format
// ("id:...;request-id:...;ts:...;"), HMAC-SHA256, and a constant-time
// comparison, and stays correct across a future signature-version bump
// (supportedVersions) without this file needing to change.

export interface WebhookSignatureInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}

export interface WebhookSignatureResult {
  valid: boolean;
  // Safe to log (an enum value, never a header/secret) — see this
  // integration's "never log... complete provider payloads" requirement.
  failureReason?: string;
}

// A 5-minute tolerance mitigates replay of a captured, otherwise-valid
// notification without being so tight that ordinary network/queueing delay
// between Mercado Pago and this server causes false rejections.
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyMercadoPagoWebhookSignature(input: WebhookSignatureInput): WebhookSignatureResult {
  try {
    WebhookSignatureValidator.validate({
      xSignature: input.xSignature,
      xRequestId: input.xRequestId,
      dataId: input.dataId,
      secret: input.secret,
      toleranceSeconds: SIGNATURE_TOLERANCE_SECONDS,
    });
    return { valid: true };
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return { valid: false, failureReason: error.reason };
    }
    throw error;
  }
}
