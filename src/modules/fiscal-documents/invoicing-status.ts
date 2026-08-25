import type { FiscalDocumentStatus } from "@/generated/prisma/client";

// Pure — no "server-only", no DB import, no Prisma runtime import (only a
// type import, erased at compile time). Deliberately separated from
// fiscal-document-core.ts (which has a real, top-level `prisma` import) so
// this stays safely importable from a plain unit test — see this
// integration's own established convention that unit tests must never
// touch a database (vitest.integration.config.ts's own comment). See the
// FiscalDocument model-group's schema comment for why this is never a
// persisted Sale column at all.

export type SaleInvoicingStatus = "NOT_INVOICED" | "PENDING" | "INVOICED" | "ERROR";

export function deriveSaleInvoicingStatus(
  activeDocument: { status: FiscalDocumentStatus } | null,
): SaleInvoicingStatus {
  if (!activeDocument) return "NOT_INVOICED";
  switch (activeDocument.status) {
    case "PENDING":
      return "PENDING";
    case "ISSUED":
      return "INVOICED";
    case "ERROR":
      return "ERROR";
    case "VOIDED":
      // Unreachable in practice — "active" (the only thing ever passed
      // here) already excludes VOIDED by construction — kept for
      // exhaustiveness, never silently falls through.
      return "NOT_INVOICED";
  }
}
