// Node-safe core: no "server-only" import, pure — builds a plain object
// mirroring WSFEv1's FECAESolicitar request shape. NEVER sends anything
// over the network (see this phase's explicit "no network send"
// requirement for section 22) and NEVER touches auth (Token/Sign/CUIT) —
// that is exclusively electronic-invoice-provider-core.ts's concern, kept
// strictly separate so business calculation can never accidentally depend
// on an auth ticket being present.
import { minorUnitsToDecimalString } from "@/lib/money";

import type { ArcaReceptorDocKind, FiscalInvoiceType } from "./arca-codes";
import {
  ARCA_CBTE_TIPO_CODE,
  ARCA_CONCEPTO_PRODUCTOS,
  ARCA_CONDICION_IVA_RECEPTOR_CODE,
  ARCA_DOC_TIPO_CODE,
  ARCA_MON_COTIZ_PESOS,
  ARCA_MON_ID_PESOS,
} from "./arca-codes";
import { alicuotaCodeForRate, type FiscalCalculationResult } from "./tax-calculation-core";
import type { RecipientVatCondition } from "@/generated/prisma/client";

// WSFEv1's SOAP contract expects plain decimal numbers for amounts — this
// is the one deliberate, documented exception to "never use Number for
// money" (see lib/money.ts's own header comment): a boundary conversion for
// an outbound third-party payload, never for storage/comparison/parsing.
function minorUnitsToArcaDecimal(amount: bigint): number {
  return Number(minorUnitsToDecimalString(amount));
}

function formatArcaDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export interface WsfeInvoiceRequestIva {
  Id: number;
  BaseImp: number;
  Importe: number;
}

// Field names deliberately match WSFEv1's own FECAESolicitar request shape
// verbatim (not renamed to a CHAIOBOUTIQUE-style camelCase) — this object
// is what a future real call would send as-is; renaming the fields here
// would just require translating them back at the network boundary for no
// benefit.
export interface WsfeInvoiceRequest {
  CbteTipo: number;
  PtoVta: number;
  Concepto: number;
  DocTipo: number;
  DocNro: string;
  CbteFch: string;
  ImpTotal: number;
  ImpNeto: number;
  ImpIVA: number;
  ImpTotConc: number;
  ImpOpEx: number;
  ImpTrib: number;
  MonId: string;
  MonCotiz: number;
  CondicionIVAReceptorId: number;
  CbteDesde: number;
  CbteHasta: number;
  Iva: WsfeInvoiceRequestIva[];
}

export interface BuildWsfeInvoiceRequestInput {
  documentType: FiscalInvoiceType;
  // The next voucher number — the CALLER resolves this (via
  // ArcaElectronicInvoiceProvider.getLastAuthorizedVoucher + 1, never a
  // local MAX(documentNumber) — see this phase's explicit correlative-
  // numbering rule). This builder just places whatever number it's given.
  voucherNumber: number;
  issuer: { pointOfSale: number };
  customer: {
    documentKind: ArcaReceptorDocKind;
    // Null only for CONSUMIDOR_FINAL_SIN_IDENTIFICAR — ARCA's own
    // convention for "no identification" is DocNro "0", applied below.
    documentNumber: string | null;
    vatCondition: RecipientVatCondition;
  };
  sale: { saleDate: Date };
  fiscalCalculation: FiscalCalculationResult;
}

// Pure mapping — no I/O, no auth, no CUIT (the issuer's CUIT is an auth/
// endpoint-routing concern, not a request-body field in FECAESolicitar's
// FeCAEReq shape). Deliberately accepts already-resolved plain values
// (documentKind, vatCondition, fiscalCalculation) rather than Prisma
// Sale/Customer rows, so this stays trivially unit-testable and never
// re-derives a business decision (document type, tax breakdown) that
// belongs in document-type-core.ts/tax-calculation-core.ts instead.
export function buildWsfeInvoiceRequest(input: BuildWsfeInvoiceRequestInput): WsfeInvoiceRequest {
  return {
    CbteTipo: ARCA_CBTE_TIPO_CODE[input.documentType],
    PtoVta: input.issuer.pointOfSale,
    Concepto: ARCA_CONCEPTO_PRODUCTOS,
    DocTipo: ARCA_DOC_TIPO_CODE[input.customer.documentKind],
    DocNro: input.customer.documentNumber ?? "0",
    CbteFch: formatArcaDate(input.sale.saleDate),
    ImpTotal: minorUnitsToArcaDecimal(input.fiscalCalculation.grossAmount),
    ImpNeto: minorUnitsToArcaDecimal(input.fiscalCalculation.netAmount),
    ImpIVA: minorUnitsToArcaDecimal(input.fiscalCalculation.taxAmount),
    // "No gravado" is not modeled as a distinct FiscalTaxCategory this
    // phase (see that enum's own comment) — ImpTotConc therefore stays 0;
    // ImpOpEx carries every EXENTO-category line's amount instead. Never
    // duplicated into the Iva array — exempt lines never appear there (see
    // tax-calculation-core.ts's own exemptAmount comment).
    ImpTotConc: 0,
    ImpOpEx: minorUnitsToArcaDecimal(input.fiscalCalculation.exemptAmount),
    ImpTrib: 0,
    MonId: ARCA_MON_ID_PESOS,
    MonCotiz: ARCA_MON_COTIZ_PESOS,
    CondicionIVAReceptorId: ARCA_CONDICION_IVA_RECEPTOR_CODE[input.customer.vatCondition],
    CbteDesde: input.voucherNumber,
    CbteHasta: input.voucherNumber,
    // One entry per DISTINCT rate — tax-calculation-core.ts's own
    // aggregation already guarantees no two entries share a rateBasisPoints
    // value, so this map can never produce a duplicate Iva group for the
    // same aliquot (this phase's explicit WSFE-builder requirement).
    Iva: input.fiscalCalculation.taxBreakdown.map((entry) => ({
      Id: alicuotaCodeForRate(entry.rateBasisPoints),
      BaseImp: minorUnitsToArcaDecimal(entry.baseAmount),
      Importe: minorUnitsToArcaDecimal(entry.taxAmount),
    })),
  };
}
