import "server-only";

// Single wrapper re-exporting this multi-file ARCA readiness/tax-model
// core — mirrors modules/payments/mercado-pago/index.ts's exact posture.
// Every Next.js-side module imports "@/modules/fiscal-documents/arca"
// unchanged; integration tests import the individual "-core" files
// directly. Pure, no-DB files (arca-codes.ts, vat-condition-labels.ts) are
// imported directly wherever needed — same posture as mercado-pago's own
// amount-core.ts, not re-exported here.

export {
  ArcaAuthNotConfiguredError,
  ArcaEnvironmentNotHomologationError,
  FakeArcaAuthProvider,
  getArcaAuthProvider,
  RealArcaAuthProvider,
  setArcaAuthProviderForTesting,
} from "./auth-provider-core";
export type { ArcaAuthProvider, ArcaAuthTicket } from "./auth-provider-core";

export {
  ArcaElectronicInvoiceNotConfiguredError,
  FakeArcaElectronicInvoiceProvider,
  getArcaElectronicInvoiceProvider,
  RealArcaElectronicInvoiceProvider,
  setArcaElectronicInvoiceProviderForTesting,
} from "./electronic-invoice-provider-core";
export type {
  ArcaElectronicInvoiceProvider,
  WsfeCaeResult,
  WsfeDummyResult,
  WsfeLastVoucherInput,
  WsfeObservation,
  WsfeVoucherDetail,
} from "./electronic-invoice-provider-core";

// Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration.
export {
  ArcaCertificateInvalidError,
  ArcaCertificateNotConfiguredError,
  ArcaCertificateUnreadableError,
  getArcaCertificateInfo,
  loadArcaCertificateConfig,
} from "./certificate-core";
export type { ArcaCertificateConfig, ArcaCertificateInfo } from "./certificate-core";

export { ArcaConnectionNotReadyError, probeArcaConnection } from "./connection-probe-core";
export type { ArcaConnectionProbeResult } from "./connection-probe-core";

export {
  ArcaIssuanceNotReadyError,
  ArcaIssuanceUncertainError,
  FiscalDocumentNotFoundError as ArcaFiscalDocumentNotFoundError,
  FiscalDocumentNotReconcilableError,
  issueElectronicInvoice,
  NoPendingArcaIntentError,
  reconcileArcaFiscalDocument,
} from "./issue-electronic-invoice-core";

export { resolveRecipientDocumentIdentification } from "./recipient-document-core";
export type { RecipientDocumentIdentification } from "./recipient-document-core";

export {
  IssuerFiscalProfileIncompleteError,
  RecipientFiscalDataRequiredError,
  resolveFiscalDocumentType,
} from "./document-type-core";
export type { ResolveFiscalDocumentTypeInput } from "./document-type-core";

export {
  CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD,
  CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD_MINOR_UNITS,
  requiresRecipientIdentification,
  resolveRecipientVatCondition,
} from "./consumer-final-core";
export type { FiscalThresholdDefinition } from "./consumer-final-core";

export {
  alicuotaCodeForRate,
  calculateFiscalAmounts,
  decomposeGrossAmount,
  MissingLineTaxCategoryError,
  UnsupportedFiscalScenarioError,
} from "./tax-calculation-core";
export type {
  CalculateFiscalAmountsInput,
  FiscalCalculationResult,
  FiscalLineInput,
  TaxBreakdownEntry,
} from "./tax-calculation-core";

export {
  FISCAL_TAX_CATEGORY_LABELS_ES,
  resolveEffectiveTaxCategory,
  resolveFiscalTaxTreatment,
} from "./fiscal-tax-category-core";
export type { FiscalTaxTreatment } from "./fiscal-tax-category-core";

export {
  ARCA_POINT_OF_SALE_MAX,
  ARCA_POINT_OF_SALE_MIN,
  formatArcaPointOfSale,
  isValidArcaPointOfSale,
} from "./point-of-sale-core";

export { buildWsfeInvoiceRequest } from "./wsfe-request-builder-core";
export type { BuildWsfeInvoiceRequestInput, WsfeInvoiceRequest, WsfeInvoiceRequestIva } from "./wsfe-request-builder-core";

export {
  getArcaConnectionReadiness,
  getArcaDataReadiness,
  getArcaReadinessForSale,
  SaleNotFoundError,
  setArcaConnectionReadinessForTesting,
} from "./readiness-core";
export type { ArcaReadinessBlocker, ArcaReadinessResult } from "./readiness-core";

export { validateWsfeRequestReadiness } from "./wsfe-validation-core";
