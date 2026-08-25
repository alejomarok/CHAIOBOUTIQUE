import type { InvoiceMode, Prisma } from "@/generated/prisma/client";

// Pure — no DB import, just Prisma's generated types. Extracted from
// sale-core.ts (which had its own private invoicingStatusWhere) so
// report-core.ts can reuse the EXACT same fiscal-state-to-WHERE-clause
// logic rather than reimplementing it — see this phase's explicit "reuse
// deriveSaleInvoicingStatus; do not reimplement fiscal state logic in the
// reporting query" requirement. Mirrors modules/fiscal-documents/
// invoicing-status.ts's deriveSaleInvoicingStatus (the read-one-Sale-at-a-
// time equivalent of this same logic) — deliberately duplicated as a
// relational WHERE builder rather than imported, since the two express the
// same business rule at different query shapes (one Sale in hand vs.
// filtering many), the same posture sale-core.ts's own original comment
// already documented.

// Mirrors modules/fiscal-documents/fiscal-document-core.ts's own
// SaleInvoicingStatus literal union.
export type SaleInvoicingStatusFilter = "NOT_INVOICED" | "PENDING" | "INVOICED" | "ERROR";

export function invoicingStatusWhere(status: SaleInvoicingStatusFilter): Prisma.SaleWhereInput {
  switch (status) {
    case "NOT_INVOICED":
      return { fiscalDocuments: { none: { status: { not: "VOIDED" } } } };
    case "PENDING":
      return { fiscalDocuments: { some: { status: "PENDING" } } };
    case "INVOICED":
      return { fiscalDocuments: { some: { status: "ISSUED" } } };
    case "ERROR":
      return { fiscalDocuments: { some: { status: "ERROR" } } };
  }
}

// New this phase — filters by invoicing MODE (Manual / Sistema externo /
// ARCA) rather than status. Only the current ACTIVE (non-VOIDED) fiscal
// document counts, same "active document defines the Sale's fiscal state"
// posture as invoicingStatusWhere/deriveSaleInvoicingStatus above — a Sale
// whose only fiscal document was voided is NOT_INVOICED again, regardless
// of what mode that voided document used to have.
export function invoicingModeWhere(mode: InvoiceMode): Prisma.SaleWhereInput {
  return { fiscalDocuments: { some: { mode, status: { not: "VOIDED" } } } };
}
