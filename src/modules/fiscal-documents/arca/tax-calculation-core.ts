// Pure — no "server-only", no DB import, no Prisma. BigInt-only arithmetic
// throughout (see lib/money.ts's own "never Number/parseFloat/toFixed for
// authoritative money" convention) — this is the one place VAT is ever
// computed, and it is never allowed to drift from the Sale's own
// authoritative totalAmount.
//
// PRICE POLICY (documented, not assumed): CHAIOBOUTIQUE's Product/
// ProductVariant prices, and therefore Sale.totalAmount, are TAX-INCLUSIVE
// final customer prices — the universal convention for Argentine consumer
// retail (a displayed price is always "final"). This phase's tax model
// therefore DECOMPOSES an already-fixed gross total into net + IVA; it
// NEVER adds IVA on top of a price and NEVER changes the amount a customer
// actually pays. See this phase's explicit "$100.000 shown in catalog must
// never become $121.000 at checkout" requirement — calculateFiscalAmounts
// below always returns a grossAmount equal to the sum of the Sale's own
// line amounts, unchanged.
//
// CORRECTION (superseding this file's earlier single-rate version): a
// Sale is no longer assumed to be entirely IVA 21% just because it's a
// Factura A/B. Each line carries its OWN FiscalTaxCategory (see
// fiscal-tax-category-core.ts and SaleItem.taxCategory), and this file
// aggregates however many DISTINCT rates are actually present into one
// taxBreakdown entry PER RATE — never one entry per line, never a
// duplicated group for the same aliquot (see this phase's explicit WSFE-
// builder aggregation requirement).
import type { FiscalTaxCategory } from "@/generated/prisma/client";

import type { FiscalInvoiceType, VatRateBasisPoints } from "./arca-codes";
import { ARCA_ALICUOTA_IVA_CODE } from "./arca-codes";
import { resolveFiscalTaxTreatment } from "./fiscal-tax-category-core";

export class UnsupportedFiscalScenarioError extends Error {
  constructor(reason: string) {
    super(`No se pudo calcular el detalle fiscal: ${reason}.`);
    this.name = "UnsupportedFiscalScenarioError";
  }
}

// Thrown when a Factura A/B needs to decompose IVA but one or more lines
// have no resolved tax category (no Product override, no store default) —
// never silently guessed as IVA 21% (see this phase's explicit correction).
// Factura C never throws this — see calculateFiscalAmounts's own FACTURA_C
// branch, which ignores line tax categories entirely.
export class MissingLineTaxCategoryError extends Error {
  constructor(lineCount: number) {
    super(
      `No se puede calcular el IVA: ${lineCount} línea(s) de la venta no tienen categoría fiscal configurada.`,
    );
    this.name = "MissingLineTaxCategoryError";
  }
}

export interface TaxBreakdownEntry {
  rateBasisPoints: VatRateBasisPoints;
  baseAmount: bigint;
  taxAmount: bigint;
}

export interface FiscalCalculationResult {
  grossAmount: bigint;
  // Sum of the taxable base across every rate group (excludes exempt lines
  // — see exemptAmount below). netAmount + taxAmount + exemptAmount ===
  // grossAmount, always, by construction — proven for arbitrary multi-line/
  // multi-rate inputs by this module's own unit tests.
  netAmount: bigint;
  taxAmount: bigint;
  // Sum of every EXENTO-category line's gross amount — these never appear
  // in taxBreakdown (they are not a rate) and never appear in the WSFEV1
  // Iva array (see wsfe-request-builder-core.ts, which routes this into
  // ImpOpEx). Always 0 for FACTURA_C (see below).
  exemptAmount: bigint;
  // At most one entry per DISTINCT rate actually present — never one per
  // line. Empty for FACTURA_C (see this phase's preserved "Factura C never
  // discriminates IVA" rule).
  taxBreakdown: TaxBreakdownEntry[];
}

// Decomposes a tax-INCLUSIVE gross amount into net + tax at a given rate,
// using pure integer division (BigInt, floor — i.e. rounding the net amount
// down, the tax amount up, to the nearest centavo). taxAmount is always
// computed as the REMAINDER (grossAmount - netAmount), never independently
// — this is what guarantees netAmount + taxAmount === grossAmount exactly,
// by construction, with zero drift, for every input (the property this
// phase's own tests must prove).
export function decomposeGrossAmount(
  grossAmount: bigint,
  rateBasisPoints: VatRateBasisPoints,
): { netAmount: bigint; taxAmount: bigint } {
  if (rateBasisPoints === 0) return { netAmount: grossAmount, taxAmount: 0n };
  const netAmount = (grossAmount * 10_000n) / (10_000n + BigInt(rateBasisPoints));
  const taxAmount = grossAmount - netAmount;
  return { netAmount, taxAmount };
}

export interface FiscalLineInput {
  grossAmount: bigint;
  // null = "not configured" — see MissingLineTaxCategoryError above. Only
  // read at all for FACTURA_A/B; FACTURA_C ignores this field entirely.
  taxCategory: FiscalTaxCategory | null;
}

export interface CalculateFiscalAmountsInput {
  lines: FiscalLineInput[];
  documentType: FiscalInvoiceType;
}

// Deterministic, side-effect-free, fully unit-testable without Prisma. See
// this phase's explicit "throw a deliberate domain error for unsupported
// scenarios; never silently fall back to tax=0 unless that's the genuinely
// configured treatment" requirement — the FACTURA_C branch below returning
// tax=0 is a deliberate, documented rule (a Monotributista/Exento issuer
// never discriminates VAT, regardless of any per-line tax metadata that may
// still exist on the underlying Products — see this phase's "Factura C"
// preservation requirement), never a fallback for an unrecognized case.
export function calculateFiscalAmounts(input: CalculateFiscalAmountsInput): FiscalCalculationResult {
  const grossAmount = input.lines.reduce((sum, line) => sum + line.grossAmount, 0n);
  if (grossAmount < 0n) {
    throw new UnsupportedFiscalScenarioError("el importe de la venta es negativo");
  }
  for (const line of input.lines) {
    if (line.grossAmount < 0n) {
      throw new UnsupportedFiscalScenarioError("una línea de la venta tiene un importe negativo");
    }
  }

  switch (input.documentType) {
    case "FACTURA_C":
      return { grossAmount, netAmount: grossAmount, taxAmount: 0n, exemptAmount: 0n, taxBreakdown: [] };
    case "FACTURA_A":
    case "FACTURA_B": {
      const missing = input.lines.filter((line) => line.taxCategory === null);
      if (missing.length > 0) throw new MissingLineTaxCategoryError(missing.length);

      const byRate = new Map<VatRateBasisPoints, { baseAmount: bigint; taxAmount: bigint }>();
      let exemptAmount = 0n;

      for (const line of input.lines) {
        // Non-null: filtered above.
        const treatment = resolveFiscalTaxTreatment(line.taxCategory!);
        if (treatment.kind === "EXEMPT") {
          exemptAmount += line.grossAmount;
          continue;
        }
        const { netAmount, taxAmount } = decomposeGrossAmount(line.grossAmount, treatment.rateBasisPoints);
        const existing = byRate.get(treatment.rateBasisPoints) ?? { baseAmount: 0n, taxAmount: 0n };
        existing.baseAmount += netAmount;
        existing.taxAmount += taxAmount;
        byRate.set(treatment.rateBasisPoints, existing);
      }

      const taxBreakdown: TaxBreakdownEntry[] = [...byRate.entries()]
        .sort(([rateA], [rateB]) => rateA - rateB)
        .map(([rateBasisPoints, { baseAmount, taxAmount }]) => ({ rateBasisPoints, baseAmount, taxAmount }));

      const netAmount = taxBreakdown.reduce((sum, entry) => sum + entry.baseAmount, 0n);
      const taxAmount = taxBreakdown.reduce((sum, entry) => sum + entry.taxAmount, 0n);

      return { grossAmount, netAmount, taxAmount, exemptAmount, taxBreakdown };
    }
    default:
      throw new UnsupportedFiscalScenarioError(`tipo de comprobante no soportado (${String(input.documentType)})`);
  }
}

// Exposed for the future WSFE request builder's Iva array — never called
// with a rate this file doesn't already know about (ARCA_ALICUOTA_IVA_CODE
// is exhaustive over VatRateBasisPoints).
export function alicuotaCodeForRate(rateBasisPoints: VatRateBasisPoints): number {
  return ARCA_ALICUOTA_IVA_CODE[rateBasisPoints];
}
