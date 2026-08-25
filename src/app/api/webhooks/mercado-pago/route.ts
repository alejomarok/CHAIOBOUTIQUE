import { NextResponse } from "next/server";

import {
  getMercadoPagoConfig,
  isMercadoPagoConfigured,
  reconcileMercadoPagoPayment,
  verifyMercadoPagoWebhookSignature,
} from "@/modules/payments/mercado-pago";

// POST-only Mercado Pago webhook endpoint — see this integration's own
// "webhook endpoint" requirements. Never trusts the notification body
// (deliberately never parsed at all — every piece of information this
// route acts on comes from the SIGNATURE-COVERED query string: `data.id`,
// `type`) or the raw event as final payment truth: the actual payment
// state is always re-fetched server-to-server inside
// reconcileMercadoPagoPayment before anything is written.
//
// Fail-closed at every step: 404s outright if Mercado Pago isn't even
// configured, 401s on an invalid/missing/malformed signature (never
// weakened for local development — see this integration's explicit "do not
// weaken webhook validation merely because development is local"
// requirement), 400s on a structurally incomplete notification. Every
// branch responds quickly with no body, matching "return an appropriate
// response quickly".
export async function POST(request: Request) {
  if (!isMercadoPagoConfigured()) {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id");
  const type = url.searchParams.get("type");
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  console.log("[mercado-pago webhook] received", { type, hasDataId: Boolean(dataId) });

  const { webhookSecret } = getMercadoPagoConfig();
  const signatureResult = verifyMercadoPagoWebhookSignature({
    xSignature,
    xRequestId,
    dataId,
    secret: webhookSecret,
  });

  if (!signatureResult.valid) {
    // Safe to log — an enum reason string, never the header/secret values
    // themselves. No state mutation on this path, ever.
    console.warn("[mercado-pago webhook] signature rejected", { reason: signatureResult.failureReason });
    return new NextResponse(null, { status: 401 });
  }

  if (!dataId) {
    return new NextResponse(null, { status: 400 });
  }

  // Only "payment" notifications are meaningful to this integration —
  // merchant_order and other event types are safely ignored. Still a 200
  // (not an error): Mercado Pago retries a non-2xx response, and there is
  // nothing to retry here.
  if (type && type !== "payment") {
    return new NextResponse(null, { status: 200 });
  }

  try {
    const result = await reconcileMercadoPagoPayment(dataId);
    console.log("[mercado-pago webhook] reconciled", { outcome: result.outcome });
  } catch (error) {
    console.error(
      "[mercado-pago webhook] reconciliation failed",
      error instanceof Error ? error.message : String(error),
    );
    // A non-2xx here lets Mercado Pago's own retry mechanism handle a
    // transient failure (e.g. a momentary DB outage) — never silently
    // swallowed as a 200.
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 200 });
}

export async function GET() {
  return new NextResponse(null, { status: 405 });
}
