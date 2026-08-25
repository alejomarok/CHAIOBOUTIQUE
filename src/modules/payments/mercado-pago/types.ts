// Shared types for the Mercado Pago Checkout Pro integration — no imports,
// no DB, no SDK dependency, so every other file in this module (and its
// tests) can share one vocabulary without a circular import.
//
// FinalizePaidOrderPaymentContext (the shape reconcile-core.ts hands to
// modules/orders/order-core.ts's finalizePaidOrder) deliberately lives in
// order-core.ts itself, not here — orders is the lower-level, generic
// domain module; payments/mercado-pago is the provider-specific integration
// built on top of it. Defining that type here would make orders depend on
// this module just for a type, backwards from every other dependency in
// this integration (see this integration's "provider abstraction"
// requirement) — reconcile-core.ts imports it from order-core.ts instead.

// What the real Mercado Pago API (via the official SDK) and the
// deterministic in-memory fake used by tests/e2e both implement — the one
// seam Mercado-Pago-specific network/SDK code crosses. Mirrors modules/
// storage's StorageProvider / modules/email's EmailProvider exact
// interface+impl+test-injection convention.
export interface CreateProviderPreferenceInput {
  externalReference: string;
  title: string;
  // Minor units in, converted to the provider's decimal major-units number
  // at the client boundary only (see amount-core.ts) — never stored or
  // compared as a float.
  unitPriceAmount: bigint;
  currency: string;
  successUrl: string;
  pendingUrl: string;
  failureUrl: string;
  notificationUrl: string;
  expiresFrom: Date;
  expiresTo: Date;
  idempotencyKey: string;
}

export interface ProviderPreference {
  preferenceId: string;
  // The single safe Checkout Pro URL the browser is redirected to — never
  // both init_point and sandbox_init_point exposed to callers; the client
  // implementation picks the right one for its own environment (see
  // client-core.ts).
  checkoutUrl: string;
}

export interface ProviderPayment {
  id: string;
  // Raw provider status string ("approved", "pending", "in_process",
  // "rejected", "cancelled", "refunded", ...) — mapped to
  // PaymentAttemptStatus by status-mapping-core.ts, never branched on
  // directly outside that one function.
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  // Minor units — already converted at the client boundary (see
  // amount-core.ts), so every caller past this point works in the same
  // BigInt-minor-units convention as the rest of this codebase.
  amount: bigint;
  currency: string;
  approvedAt: Date | null;
}

export interface MercadoPagoClient {
  createPreference(input: CreateProviderPreferenceInput): Promise<ProviderPreference>;
  getPayment(providerPaymentId: string): Promise<ProviderPayment | null>;
}
