// Pure — no "server-only", no DB import. The isolation boundary this
// phase's correction explicitly requires: "Keep: domain tax category ->
// ARCA mapping isolated." FiscalTaxCategory (the Prisma enum, a catalog/
// commercial concept an admin picks for a Product) never appears in
// arca-codes.ts, and no ARCA numeric Id ever appears here — this file is
// the ONE place that translates between them, via the intermediate
// VatRateBasisPoints domain concept tax-calculation-core.ts already owns.
import type { FiscalTaxCategory } from "@/generated/prisma/client";

import type { VatRateBasisPoints } from "./arca-codes";

export const FISCAL_TAX_CATEGORY_LABELS_ES: Record<FiscalTaxCategory, string> = {
  IVA_21: "IVA 21%",
  IVA_10_5: "IVA 10,5%",
  IVA_27: "IVA 27%",
  IVA_5: "IVA 5%",
  IVA_2_5: "IVA 2,5%",
  IVA_0: "IVA 0%",
  EXENTO: "Exento / no gravado",
};

export type FiscalTaxTreatment =
  | { kind: "TAXABLE"; rateBasisPoints: VatRateBasisPoints }
  | { kind: "EXEMPT" };

// The ONE mapping from a catalog-level tax category to what
// calculate FiscalAmounts actually needs to decompose a gross amount —
// never guessed, exhaustive over the enum (a new FiscalTaxCategory value
// requires touching this switch, which is the point: no silent fallback).
export function resolveFiscalTaxTreatment(category: FiscalTaxCategory): FiscalTaxTreatment {
  switch (category) {
    case "IVA_0":
      return { kind: "TAXABLE", rateBasisPoints: 0 };
    case "IVA_2_5":
      return { kind: "TAXABLE", rateBasisPoints: 250 };
    case "IVA_10_5":
      return { kind: "TAXABLE", rateBasisPoints: 1050 };
    case "IVA_21":
      return { kind: "TAXABLE", rateBasisPoints: 2100 };
    case "IVA_27":
      return { kind: "TAXABLE", rateBasisPoints: 2700 };
    case "IVA_5":
      return { kind: "TAXABLE", rateBasisPoints: 500 };
    case "EXENTO":
      return { kind: "EXEMPT" };
  }
}

// The commercial-boundary resolver (Product override -> StoreConfiguration
// default -> null) — see sale-core.ts's resolveSaleItem for where this is
// actually called, at the exact moment a SaleItem is created, snapshotting
// whatever this resolves to at that instant. Never re-run against live data
// afterward. Pure: takes plain values, not Prisma rows, so this stays
// trivially unit-testable.
export function resolveEffectiveTaxCategory(input: {
  productOverride: FiscalTaxCategory | null;
  storeDefault: FiscalTaxCategory | null;
}): FiscalTaxCategory | null {
  return input.productOverride ?? input.storeDefault ?? null;
}

export interface SaleItemTaxSnapshot {
  taxCategory: FiscalTaxCategory | null;
  taxRateBasisPoints: number | null;
}

// The single shared "what does a SaleItem/OrderItem-derived SaleItem
// actually snapshot" resolver — used identically by modules/sales/
// sale-core.ts's resolveSaleItem (POS) and modules/orders/order-core.ts's
// finalizePaidOrderTransactionally (online checkout), so the two commercial
// entry points can never silently diverge in how a line's fiscal snapshot
// is decided.
export function resolveSaleItemTaxSnapshot(input: {
  productOverride: FiscalTaxCategory | null;
  storeDefault: FiscalTaxCategory | null;
}): SaleItemTaxSnapshot {
  const taxCategory = resolveEffectiveTaxCategory(input);
  if (taxCategory === null) return { taxCategory: null, taxRateBasisPoints: null };

  const treatment = resolveFiscalTaxTreatment(taxCategory);
  return {
    taxCategory,
    taxRateBasisPoints: treatment.kind === "TAXABLE" ? treatment.rateBasisPoints : null,
  };
}
