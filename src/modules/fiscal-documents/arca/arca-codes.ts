// Pure — no "server-only", no DB import, no network. The ISOLATED ARCA
// code-mapping layer this phase's spec explicitly requires (section 7):
// every magic number ARCA's WSFEV1 API expects lives HERE, named, with its
// source documented — never scattered as bare literals (1/6/80/99/...)
// elsewhere in the application.
//
// SOURCE / VERSION (re-verified during the ARCA Fiscal Readiness
// correction pass): WSFEv1 "Manual para el Desarrollador", R.G. 4291
// lineage. The canonical download link on BOTH of ARCA's own current
// landing pages (afip.gob.ar/fe/ayuda/webservice.asp and arca.gob.ar/ws/
// documentacion/ws-factura-electronica.asp) advertises **V. 4.6**
// (manual-desarrollador-ARCA-COMPG.pdf) as of this correction pass —
// PINNED as the reference version. DISCREPANCY NOTED: cached search-engine
// snippets for a differently-named mirror file (wsfev1-RG-4291.pdf)
// inconsistently showed "v4.5" and "v4.7" across two separate queries in
// the same session — neither of those is what the live landing pages
// themselves advertise, so they are NOT relied on; if a maintainer opens
// the actual PDF and finds a different revision number on its cover page,
// treat v4.6 as superseded and update this comment. Regulatory lineage:
// RG 4291 (WSFEv1 itself) + RG 5616/2024 (CondicionIVAReceptorId,
// mandatory since 2026-06-01) + RG 5700/2025 (Consumidor Final
// identification threshold — see consumer-final-core.ts).
//
// VERIFICATION MARKER for the tables below — each is independently
// re-checked, not "treated as unquestionable static truth" (this phase's
// own explicit warning):
//   ARCA_CBTE_TIPO_CODE:              CROSS-VERIFIED (2 independent sources)
//   ARCA_DOC_TIPO_CODE:               CROSS-VERIFIED (2 independent sources)
//   ARCA_CONDICION_IVA_RECEPTOR_CODE: CROSS-VERIFIED (RG 5616/2024 text)
//   ARCA_ALICUOTA_IVA_CODE:           CROSS-VERIFIED this correction pass —
//     upgraded from the earlier "best-effort, unverified" caveat via the
//     official FEParamGetTiposIva method's own published return shape,
//     corroborated by an independent second source. STILL not a substitute
//     for a live homologation-environment call: before this integration
//     ever requests a real CAE, these codes MUST be reconciled against a
//     live call to WSFEV1's own FEParamGetTiposIva /
//     FEParamGetCondicionIvaReceptor parameter methods (see
//     ArcaElectronicInvoiceProvider.getParameterTable in
//     electronic-invoice-provider-core.ts) — this file remains a
//     documented snapshot for the "still not connected to ARCA" phase,
//     never self-certifying. (Note: an earlier version of this comment
//     named the method "FEParamGetAlicuotas" — that name is WRONG; the
//     real WSFEv1 method is FEParamGetTiposIva, corrected here.)
//
// Only the codes CHAIOBOUTIQUE's own domain model (IssuerVatCondition/
// RecipientVatCondition/FiscalInvoiceType/FiscalTaxCategory, see
// document-type-core.ts and fiscal-tax-category-core.ts) can actually
// produce are mapped here — this is deliberately NOT a full copy of every
// ARCA table value (see this phase's "do not persist a giant manually-
// maintained copy of ARCA tables unless justified" instruction).

import type { RecipientVatCondition } from "@/generated/prisma/client";

// CbteTipo — comprobante/document type code. Only A/B/C invoices are
// modeled: CHAIOBOUTIQUE never issues notas de crédito/débito or receipts
// through this system yet.
export type FiscalInvoiceType = "FACTURA_A" | "FACTURA_B" | "FACTURA_C";

export const ARCA_CBTE_TIPO_CODE: Record<FiscalInvoiceType, number> = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
};

export const FISCAL_INVOICE_TYPE_LABELS_ES: Record<FiscalInvoiceType, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
};

// DocTipo — recipient identification-document type code. CUIL (86) is a
// real ARCA code but not modeled: CHAIOBOUTIQUE's Customer model has no
// concept of a recipient identified only by CUIL rather than CUIT/DNI.
export type ArcaReceptorDocKind = "CUIT" | "DNI" | "CONSUMIDOR_FINAL_SIN_IDENTIFICAR";

export const ARCA_DOC_TIPO_CODE: Record<ArcaReceptorDocKind, number> = {
  CUIT: 80,
  DNI: 96,
  CONSUMIDOR_FINAL_SIN_IDENTIFICAR: 99,
};

// CondicionIVAReceptorId — mandatory since RG 5616/2024 (2026-06-01). Only
// the 5 categories RecipientVatCondition actually models are mapped (see
// that enum's own schema comment for why the full 11-code ARCA table is
// deliberately not mirrored 1:1 into this codebase's domain model).
export const ARCA_CONDICION_IVA_RECEPTOR_CODE: Record<RecipientVatCondition, number> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTISTA: 6,
  IVA_NO_ALCANZADO: 7,
};

// Concepto — CHAIOBOUTIQUE only ever sells physical products (never
// services, never a mixed products+services invoice) — this is a fixed
// domain fact, not a per-Sale choice, so it is a constant rather than a
// configurable field.
export const ARCA_CONCEPTO_PRODUCTOS = 1;

// MonId — the store operates in a single currency (ARS) today; see
// Cart/Order's own "single-currency today, but every row still carries its
// own currency" posture. MonCotiz is always 1 (no currency conversion) as
// long as MonId stays "PES".
export const ARCA_MON_ID_PESOS = "PES";
export const ARCA_MON_COTIZ_PESOS = 1;

// Iva array Id — the alícuota (VAT rate) code. See this file's own header
// verification marker. 500 (5%) was missing from an earlier version of
// this table — a real, distinct FEParamGetTiposIva code (Id 8), corrected
// here; FiscalTaxCategory.IVA_5 depends on it (see
// fiscal-tax-category-core.ts).
export type VatRateBasisPoints = 0 | 250 | 500 | 1050 | 2100 | 2700;

export const ARCA_ALICUOTA_IVA_CODE: Record<VatRateBasisPoints, number> = {
  0: 3,
  250: 9,
  500: 8,
  1050: 4,
  2100: 5,
  2700: 6,
};
