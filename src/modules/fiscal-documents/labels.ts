// Pure constants — no "server-only", no DB import — importable from both
// Server Components/Actions and Client Components. Never expose internal
// enum names directly in the UI (this phase's own explicit requirement) —
// every surface that shows an invoicing mode/status reads from here, never
// a raw enum value.
import type { FiscalDocumentStatus, InvoiceMode } from "@/generated/prisma/client";

import type { SaleInvoicingStatus } from "./invoicing-status";

export const INVOICE_MODE_LABELS_ES: Record<InvoiceMode, string> = {
  ELECTRONICA_ARCA: "Facturación electrónica ARCA",
  MANUAL: "Comprobante manual",
  SISTEMA_EXTERNO: "Facturado en sistema externo",
};

// One individual FiscalDocument row's own status — distinct from
// SaleInvoicingStatus below, which is the Sale-level derived summary.
export const FISCAL_DOCUMENT_STATUS_LABELS_ES: Record<FiscalDocumentStatus, string> = {
  PENDING: "Pendiente",
  ISSUED: "Emitido",
  ERROR: "Error",
  VOIDED: "Anulado",
};

export const SALE_INVOICING_STATUS_LABELS_ES: Record<SaleInvoicingStatus, string> = {
  NOT_INVOICED: "Sin facturar",
  PENDING: "Pendiente",
  INVOICED: "Facturada",
  ERROR: "Error",
};

// Restrained, same 3-variant vocabulary as every other status badge in
// this codebase (outline = nothing happened yet, default = a resolved/
// successful state, secondary = a terminal, non-alarming negative state) —
// "ERROR" is the one deliberate exception (destructive), matching this
// phase's own "if reconciliation failed, show a strong operational
// warning" precedent from the Mercado Pago integration.
export const SALE_INVOICING_STATUS_BADGE_VARIANT: Record<
  SaleInvoicingStatus,
  "default" | "outline" | "secondary" | "destructive"
> = {
  NOT_INVOICED: "outline",
  PENDING: "secondary",
  INVOICED: "default",
  ERROR: "destructive",
};

export const FISCAL_DOCUMENT_STATUS_BADGE_VARIANT: Record<
  FiscalDocumentStatus,
  "default" | "outline" | "secondary" | "destructive"
> = {
  PENDING: "secondary",
  ISSUED: "default",
  ERROR: "destructive",
  VOIDED: "outline",
};

// The Sale detail "Facturación" card's "Comprobante" line — a single
// human-readable identification string, verbatim from whatever the admin
// actually entered (never reformatted/zero-padded — this phase does not
// invent a canonical Argentine numbering format). Returns null when there
// is nothing to identify yet (an ELECTRONICA_ARCA PENDING intent).
export function formatFiscalDocumentIdentifier(document: {
  documentType: string | null;
  pointOfSale: string | null;
  documentNumber: string | null;
}): string | null {
  if (!document.documentNumber) return null;
  const parts = [document.documentType, document.pointOfSale ? `${document.pointOfSale}-${document.documentNumber}` : document.documentNumber];
  return parts.filter(Boolean).join(" ");
}
