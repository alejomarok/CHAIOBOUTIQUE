import type { CreateProviderPreferenceInput, MercadoPagoClient, ProviderPayment, ProviderPreference } from "./types";

// Deterministic, in-memory, no-network fake — used by BOTH automated tests
// (unit/integration, via setMercadoPagoClientForTesting) AND the e2e suite
// (via getMercadoPagoClient()'s own E2E_TEST_MODE selection — see
// client-core.ts), so there is exactly one fake implementation, never two
// parallel ones. Mirrors modules/storage/e2e-provider.ts's exact posture:
// selected only in a test context, changes no production behavior, and
// never calls the real Mercado Pago API.
//
// Backed by globalThis, not a plain module-level Map — same reasoning as
// modules/storage/e2e-provider.ts's own store: Next.js/Turbopack compiles
// Server Actions and Route Handlers into separate module "layers", so a
// preference created by a Server Action (createMercadoPagoPreference) must
// still be visible to the Route Handler that serves the fake checkout page
// and to the webhook route that later reconciles it — only globalThis is
// guaranteed to be the same object across those layers within one process.
export type FakePaymentOutcome = "approved" | "pending" | "in_process" | "rejected" | "cancelled" | "refunded";

interface FakePreferenceRecord {
  preferenceId: string;
  externalReference: string;
  amount: bigint;
  currency: string;
  status: FakePaymentOutcome;
  paymentId: string | null;
  approvedAt: Date | null;
  // Persisted so the fake checkout route (src/app/api/e2e-mercado-pago/
  // checkout/route.ts) can redirect back to the exact URL a real Mercado
  // Pago Checkout Pro session would have used — mirrors real back_urls.
  successUrl: string;
  pendingUrl: string;
  failureUrl: string;
}

const globalForFakeMercadoPago = globalThis as unknown as {
  __fakeMercadoPagoPreferences: Map<string, FakePreferenceRecord> | undefined;
  __fakeMercadoPagoPaymentIndex: Map<string, string> | undefined;
};

const preferences = (globalForFakeMercadoPago.__fakeMercadoPagoPreferences ??= new Map());
const paymentIndex = (globalForFakeMercadoPago.__fakeMercadoPagoPaymentIndex ??= new Map());

export class FakeMercadoPagoClient implements MercadoPagoClient {
  async createPreference(input: CreateProviderPreferenceInput): Promise<ProviderPreference> {
    const preferenceId = `fake-pref-${crypto.randomUUID()}`;
    preferences.set(preferenceId, {
      preferenceId,
      externalReference: input.externalReference,
      amount: input.unitPriceAmount,
      currency: input.currency,
      status: "pending",
      paymentId: null,
      approvedAt: null,
      successUrl: input.successUrl,
      pendingUrl: input.pendingUrl,
      failureUrl: input.failureUrl,
    });
    return {
      preferenceId,
      // Relative — the browser is already on this app's own origin, same
      // posture as E2EStorageProvider's getPublicUrl. Served by
      // src/app/api/e2e-mercado-pago/checkout/route.ts, 404s unless
      // E2E_TEST_MODE is set.
      checkoutUrl: `/api/e2e-mercado-pago/checkout?preferenceId=${preferenceId}`,
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment | null> {
    const preferenceId = paymentIndex.get(providerPaymentId);
    if (!preferenceId) return null;
    const record = preferences.get(preferenceId);
    if (!record || record.paymentId !== providerPaymentId) return null;

    return {
      id: providerPaymentId,
      status: record.status,
      statusDetail: null,
      externalReference: record.externalReference,
      amount: record.amount,
      currency: record.currency,
      approvedAt: record.approvedAt,
    };
  }
}

export function getFakePreference(preferenceId: string): FakePreferenceRecord | undefined {
  return preferences.get(preferenceId);
}

// Test/e2e-only: simulates Mercado Pago reporting an outcome for an
// existing preference — generates a fake provider payment id, indexes it,
// and returns it so the caller (a test, or the fake checkout route) can
// send a webhook notification referencing it. Overriding amount/currency is
// what lets tests exercise the amount/currency-mismatch reconciliation path
// deterministically, without needing a real provider to ever disagree with
// itself.
export function simulateMercadoPagoPayment(
  preferenceId: string,
  outcome: FakePaymentOutcome,
  overrides: { amount?: bigint; currency?: string } = {},
): { paymentId: string } {
  const record = preferences.get(preferenceId);
  if (!record) throw new Error(`Fake Mercado Pago preference not found: ${preferenceId}`);

  const paymentId = `fake-pay-${crypto.randomUUID()}`;
  record.status = outcome;
  record.paymentId = paymentId;
  record.approvedAt = outcome === "approved" ? new Date() : null;
  if (overrides.amount !== undefined) record.amount = overrides.amount;
  if (overrides.currency !== undefined) record.currency = overrides.currency;

  paymentIndex.set(paymentId, preferenceId);
  return { paymentId };
}

export function resetFakeMercadoPagoStore(): void {
  preferences.clear();
  paymentIndex.clear();
}
