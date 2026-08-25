import { createHmac, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  getFakePreference,
  simulateMercadoPagoPayment,
  type FakePaymentOutcome,
} from "@/modules/payments/mercado-pago/fake-client-core";

// The e2e counterpart to a real Mercado Pago Checkout Pro session — served
// only when E2E_TEST_MODE is set (404s unconditionally otherwise, same
// fail-closed posture as src/app/api/e2e-storage's route), so this route
// has zero surface area in real dev/production. See FakeMercadoPagoClient's
// own comment for why this exists: the e2e suite needs a real page the
// browser can navigate to and click through, deterministically, with no
// real Mercado Pago network access — see this integration's "deterministic
// fake provider in test environment" requirement.
//
// Deliberately sends a REAL, validly-signed webhook notification to the
// REAL webhook route (src/app/api/webhooks/mercado-pago) when an outcome is
// chosen — the e2e suite must genuinely exercise signature verification and
// reconciliation end-to-end, never bypass them by calling
// reconcileMercadoPagoPayment directly from test code.

const OUTCOMES: FakePaymentOutcome[] = ["approved", "rejected", "pending", "in_process", "cancelled", "refunded"];

function buildFakeSignatureHeaders(dataId: string, requestId: string, secret: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  // Exact manifest format the real WebhookSignatureValidator expects — see
  // this integration's final report for where this was verified against
  // the actually-installed `mercadopago` package's own source.
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = createHmac("sha256", secret).update(manifest).digest("hex");
  return { "x-signature": `ts=${ts},v1=${hash}`, "x-request-id": requestId };
}

function renderChoicePage(preferenceId: string, amount: bigint, currency: string): string {
  const link = (outcome: FakePaymentOutcome, label: string) =>
    `<a data-testid="fake-mp-${outcome}" href="?preferenceId=${encodeURIComponent(preferenceId)}&outcome=${outcome}">${label}</a>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Fake Mercado Pago</title></head>
<body>
  <h1>Checkout Pro (fake — solo para e2e)</h1>
  <p data-testid="fake-mp-amount">Importe: ${amount} ${currency}</p>
  <ul>
    <li>${link("approved", "Aprobar pago (fake)")}</li>
    <li>${link("rejected", "Rechazar pago (fake)")}</li>
    <li>${link("pending", "Dejar pendiente (fake)")}</li>
  </ul>
</body></html>`;
}

export async function GET(request: Request) {
  if (!env.E2E_TEST_MODE) {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  const preferenceId = url.searchParams.get("preferenceId");
  const outcomeParam = url.searchParams.get("outcome");
  if (!preferenceId) return new NextResponse(null, { status: 400 });

  const preference = getFakePreference(preferenceId);
  if (!preference) return new NextResponse(null, { status: 404 });

  if (!outcomeParam) {
    return new NextResponse(renderChoicePage(preferenceId, preference.amount, preference.currency), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!OUTCOMES.includes(outcomeParam as FakePaymentOutcome)) {
    return new NextResponse(null, { status: 400 });
  }
  const outcome = outcomeParam as FakePaymentOutcome;

  const { paymentId } = simulateMercadoPagoPayment(preferenceId, outcome);

  if (env.MERCADO_PAGO_WEBHOOK_SECRET) {
    const requestId = randomUUID();
    const headers = buildFakeSignatureHeaders(paymentId, requestId, env.MERCADO_PAGO_WEBHOOK_SECRET);
    const webhookUrl = new URL("/api/webhooks/mercado-pago", url.origin);
    webhookUrl.searchParams.set("data.id", paymentId);
    webhookUrl.searchParams.set("type", "payment");
    await fetch(webhookUrl, { method: "POST", headers });
  }

  const redirectTarget =
    outcome === "approved"
      ? preference.successUrl
      : outcome === "rejected" || outcome === "cancelled"
        ? preference.failureUrl
        : preference.pendingUrl;

  return NextResponse.redirect(redirectTarget);
}
