import "server-only";

// The actual implementations live in the various "-core.ts" files, none of
// which import "server-only" — mirrors modules/storage/index.ts's exact
// posture (a single wrapper re-exporting a multi-file core, since this
// integration — like storage — has several internal files: config, client,
// fake-client, signature, status-mapping, amount, preference, reconcile).
// Every Next.js-side module imports "@/modules/payments/mercado-pago"
// unchanged; integration tests import the individual "-core" files directly
// (vitest aliases "server-only" to a no-op, so either works there, but
// importing the core keeps one obviously-CLI-safe entry point).
export {
  getMercadoPagoConfig,
  getMercadoPagoDiagnosticLabel,
  getMercadoPagoReadiness,
  isMercadoPagoConfigured,
  MercadoPagoNotConfiguredError,
  setMercadoPagoConfigForTesting,
} from "./config-core";
export type { MercadoPagoConfigValues, MercadoPagoReadiness, MercadoPagoReadinessCheck } from "./config-core";

export {
  getMercadoPagoClient,
  RealMercadoPagoClient,
  setMercadoPagoClientForTesting,
} from "./client-core";

export {
  createMercadoPagoPreference,
  OrderNotFoundError,
  OrderNotPayableError,
  OrderRequiresReviewError,
} from "./preference-core";
export type { CreateMercadoPagoPreferenceInput, CreateMercadoPagoPreferenceResult } from "./preference-core";

export { reconcileMercadoPagoPayment } from "./reconcile-core";
export type { ReconcileOutcome, ReconcileResult } from "./reconcile-core";

export { verifyMercadoPagoWebhookSignature } from "./signature-core";
export type { WebhookSignatureInput, WebhookSignatureResult } from "./signature-core";

export { mapMercadoPagoPaymentStatus } from "./status-mapping-core";
export type { MappedMercadoPagoStatus } from "./status-mapping-core";
