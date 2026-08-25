// Node-safe core: no "server-only" import. Section 23's pre-network
// validation: before any future real WSFEV1 call, verify EVERYTHING that
// can be verified locally, and fail with a clear admin message before ever
// reaching out to ARCA — network is the last, most expensive, least
// reversible step, never the first line of validation.
//
// This is a strict SUPERSET of getArcaReadinessForSale (issuer config,
// point of sale, document type, recipient identification/VAT condition) —
// it additionally checks the specific Sale/FiscalDocument STATE a real
// request would require (Sale still CONFIRMED, an actual PENDING
// ELECTRONICA_ARCA intent to advance, a supported currency) — concerns
// getArcaReadinessForSale deliberately leaves out because it must also
// answer "is this Sale ready in general", independent of any specific
// FiscalDocument row existing yet.
import { prisma } from "@/lib/db-core";

import type { ArcaReadinessBlocker, ArcaReadinessResult } from "./readiness-core";
import { getArcaReadinessForSale, SaleNotFoundError } from "./readiness-core";

export { SaleNotFoundError };

export async function validateWsfeRequestReadiness(saleId: string): Promise<ArcaReadinessResult> {
  const [sale, activeDocument, saleReadiness] = await Promise.all([
    prisma.sale.findUnique({ where: { id: saleId } }),
    prisma.fiscalDocument.findFirst({
      where: { saleId, status: { not: "VOIDED" } },
      orderBy: { createdAt: "desc" },
    }),
    getArcaReadinessForSale(saleId),
  ]);
  if (!sale) throw new SaleNotFoundError();

  const blockers: ArcaReadinessBlocker[] = [...saleReadiness.blockers];

  if (sale.status !== "CONFIRMED") {
    blockers.push({ code: "SALE_NOT_CONFIRMED", message: "Solo se pueden facturar ventas confirmadas." });
  }
  if (!activeDocument || activeDocument.mode !== "ELECTRONICA_ARCA" || activeDocument.status !== "PENDING") {
    blockers.push({
      code: "NO_PENDING_ARCA_INTENT",
      message: "No hay una intención de facturación electrónica ARCA pendiente para esta venta.",
    });
  }
  // ARCA_MON_ID_PESOS (arca-codes.ts) only supports "ARS" — the only
  // currency this store's FiscalDocument.currency has ever held (copied
  // from StoreConfiguration.currency at creation time), but checked
  // explicitly rather than assumed, since a future multi-currency change
  // must not silently start sending an unsupported MonId.
  if (activeDocument && activeDocument.currency !== "ARS") {
    blockers.push({ code: "UNSUPPORTED_CURRENCY", message: "Moneda no soportada para facturación electrónica." });
  }

  return { ready: blockers.length === 0, blockers };
}
