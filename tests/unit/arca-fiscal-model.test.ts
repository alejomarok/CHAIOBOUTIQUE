import { describe, expect, it } from "vitest";

import {
  ARCA_CBTE_TIPO_CODE,
  ARCA_CONDICION_IVA_RECEPTOR_CODE,
  ARCA_DOC_TIPO_CODE,
} from "@/modules/fiscal-documents/arca/arca-codes";
import {
  CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD_MINOR_UNITS,
  requiresRecipientIdentification,
  resolveRecipientVatCondition,
} from "@/modules/fiscal-documents/arca/consumer-final-core";
import {
  IssuerFiscalProfileIncompleteError,
  RecipientFiscalDataRequiredError,
  resolveFiscalDocumentType,
} from "@/modules/fiscal-documents/arca/document-type-core";
import {
  calculateFiscalAmounts,
  decomposeGrossAmount,
  MissingLineTaxCategoryError,
  UnsupportedFiscalScenarioError,
} from "@/modules/fiscal-documents/arca/tax-calculation-core";
import {
  FISCAL_TAX_CATEGORY_LABELS_ES,
  resolveEffectiveTaxCategory,
  resolveFiscalTaxTreatment,
} from "@/modules/fiscal-documents/arca/fiscal-tax-category-core";
import {
  ARCA_POINT_OF_SALE_MAX,
  ARCA_POINT_OF_SALE_MIN,
  formatArcaPointOfSale,
  isValidArcaPointOfSale,
} from "@/modules/fiscal-documents/arca/point-of-sale-core";
import { buildWsfeInvoiceRequest } from "@/modules/fiscal-documents/arca/wsfe-request-builder-core";

describe("resolveFiscalDocumentType", () => {
  it("never guesses: throws when the issuer profile is incomplete", () => {
    expect(() =>
      resolveFiscalDocumentType({ issuerVatCondition: null, recipientVatCondition: "CONSUMIDOR_FINAL" }),
    ).toThrow(IssuerFiscalProfileIncompleteError);
  });

  it("never guesses: throws when the recipient's condition is not determined", () => {
    expect(() =>
      resolveFiscalDocumentType({ issuerVatCondition: "RESPONSABLE_INSCRIPTO", recipientVatCondition: null }),
    ).toThrow(RecipientFiscalDataRequiredError);
  });

  it("a Monotributista issuer always emits Factura C, regardless of recipient", () => {
    expect(
      resolveFiscalDocumentType({
        issuerVatCondition: "MONOTRIBUTISTA",
        recipientVatCondition: "RESPONSABLE_INSCRIPTO",
      }),
    ).toBe("FACTURA_C");
    expect(
      resolveFiscalDocumentType({ issuerVatCondition: "MONOTRIBUTISTA", recipientVatCondition: "CONSUMIDOR_FINAL" }),
    ).toBe("FACTURA_C");
  });

  it("an Exento issuer always emits Factura C", () => {
    expect(
      resolveFiscalDocumentType({ issuerVatCondition: "EXENTO", recipientVatCondition: "RESPONSABLE_INSCRIPTO" }),
    ).toBe("FACTURA_C");
  });

  it("a Responsable Inscripto issuer emits Factura A only to a fellow Responsable Inscripto", () => {
    expect(
      resolveFiscalDocumentType({
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        recipientVatCondition: "RESPONSABLE_INSCRIPTO",
      }),
    ).toBe("FACTURA_A");
  });

  it("a Responsable Inscripto issuer emits Factura B to every other recipient condition", () => {
    expect(
      resolveFiscalDocumentType({
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        recipientVatCondition: "CONSUMIDOR_FINAL",
      }),
    ).toBe("FACTURA_B");
    expect(
      resolveFiscalDocumentType({
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        recipientVatCondition: "MONOTRIBUTISTA",
      }),
    ).toBe("FACTURA_B");
  });
});

describe("isValidArcaPointOfSale — WSFEv1's actual 5-digit PtoVta range (1..99998)", () => {
  it("bounds are 1 and 99998, not the old, wrong 4-digit 1..9999", () => {
    expect(ARCA_POINT_OF_SALE_MIN).toBe(1);
    expect(ARCA_POINT_OF_SALE_MAX).toBe(99998);
  });

  it.each([1, 9999, 10000, 99998])("accepts %i", (value) => {
    expect(isValidArcaPointOfSale(value)).toBe(true);
  });

  it.each([0, 99999, -1, -100])("rejects %i", (value) => {
    expect(isValidArcaPointOfSale(value)).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(isValidArcaPointOfSale(1.5)).toBe(false);
    expect(isValidArcaPointOfSale(NaN)).toBe(false);
  });
});

describe("formatArcaPointOfSale — presentation-layer zero-padding only, never truncates a 5-digit value", () => {
  it("pads a short point of sale to a minimum of 4 digits", () => {
    expect(formatArcaPointOfSale(1)).toBe("0001");
    expect(formatArcaPointOfSale(4)).toBe("0004");
  });

  it("never truncates a genuine 5-digit point of sale — this is a MINIMUM width, not a fixed one", () => {
    expect(formatArcaPointOfSale(10000)).toBe("10000");
    expect(formatArcaPointOfSale(99998)).toBe("99998");
  });
});

describe("Consumidor Final identification threshold (RG 5700/2025)", () => {
  it("is exactly ARS 10.000.000 in minor units", () => {
    expect(CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD_MINOR_UNITS).toBe(1_000_000_000n);
  });

  it("does not require identification below the threshold", () => {
    expect(requiresRecipientIdentification(999_999_999n)).toBe(false);
  });

  it("requires identification at or above the threshold", () => {
    expect(requiresRecipientIdentification(1_000_000_000n)).toBe(true);
    expect(requiresRecipientIdentification(1_000_000_001n)).toBe(true);
  });
});

describe("resolveRecipientVatCondition", () => {
  it("an explicit Customer.vatCondition always wins outright", () => {
    expect(
      resolveRecipientVatCondition({
        explicitVatCondition: "RESPONSABLE_INSCRIPTO",
        hasIdentification: false,
        saleTotalAmountMinorUnits: 5_000_000_000n,
      }),
    ).toBe("RESPONSABLE_INSCRIPTO");
  });

  it("an unclassified customer below the threshold resolves to Consumidor Final with no identification needed", () => {
    expect(
      resolveRecipientVatCondition({
        explicitVatCondition: null,
        hasIdentification: false,
        saleTotalAmountMinorUnits: 100_000n,
      }),
    ).toBe("CONSUMIDOR_FINAL");
  });

  it("an unclassified, unidentified customer at/above the threshold throws — never silently allowed", () => {
    expect(() =>
      resolveRecipientVatCondition({
        explicitVatCondition: null,
        hasIdentification: false,
        saleTotalAmountMinorUnits: 1_000_000_000n,
      }),
    ).toThrow(RecipientFiscalDataRequiredError);
  });

  it("an unclassified but IDENTIFIED customer at/above the threshold resolves to Consumidor Final", () => {
    expect(
      resolveRecipientVatCondition({
        explicitVatCondition: null,
        hasIdentification: true,
        saleTotalAmountMinorUnits: 5_000_000_000n,
      }),
    ).toBe("CONSUMIDOR_FINAL");
  });
});

describe("decomposeGrossAmount — BigInt-safe VAT decomposition", () => {
  it("returns the full gross as net, zero tax, at a 0% rate", () => {
    expect(decomposeGrossAmount(100_000n, 0)).toEqual({ netAmount: 100_000n, taxAmount: 0n });
  });

  it("decomposes a round 21%-inclusive amount exactly", () => {
    // 121.00 gross at 21% -> 100.00 net + 21.00 tax, exactly.
    expect(decomposeGrossAmount(12_100n, 2100)).toEqual({ netAmount: 10_000n, taxAmount: 2_100n });
  });

  it("never changes the gross amount: net + tax always sums back to gross exactly, for arbitrary inputs", () => {
    const amounts = [1n, 99n, 100n, 12_345n, 999_999_999n, 1_000_000_001n, 7n];
    const rates: Array<0 | 250 | 1050 | 2100 | 2700> = [0, 250, 1050, 2100, 2700];
    for (const gross of amounts) {
      for (const rate of rates) {
        const { netAmount, taxAmount } = decomposeGrossAmount(gross, rate);
        expect(netAmount + taxAmount).toBe(gross);
        expect(netAmount).toBeGreaterThanOrEqual(0n);
        expect(taxAmount).toBeGreaterThanOrEqual(0n);
      }
    }
  });
});

describe("resolveFiscalTaxTreatment / resolveEffectiveTaxCategory — domain category <-> rate isolation", () => {
  it("every FiscalTaxCategory has a Spanish label", () => {
    for (const category of ["IVA_21", "IVA_10_5", "IVA_27", "IVA_5", "IVA_2_5", "IVA_0", "EXENTO"] as const) {
      expect(typeof FISCAL_TAX_CATEGORY_LABELS_ES[category]).toBe("string");
    }
  });

  it("maps each IVA_* category to its correct rate in basis points", () => {
    expect(resolveFiscalTaxTreatment("IVA_0")).toEqual({ kind: "TAXABLE", rateBasisPoints: 0 });
    expect(resolveFiscalTaxTreatment("IVA_2_5")).toEqual({ kind: "TAXABLE", rateBasisPoints: 250 });
    expect(resolveFiscalTaxTreatment("IVA_5")).toEqual({ kind: "TAXABLE", rateBasisPoints: 500 });
    expect(resolveFiscalTaxTreatment("IVA_10_5")).toEqual({ kind: "TAXABLE", rateBasisPoints: 1050 });
    expect(resolveFiscalTaxTreatment("IVA_21")).toEqual({ kind: "TAXABLE", rateBasisPoints: 2100 });
    expect(resolveFiscalTaxTreatment("IVA_27")).toEqual({ kind: "TAXABLE", rateBasisPoints: 2700 });
  });

  it("EXENTO resolves to EXEMPT, never a rate", () => {
    expect(resolveFiscalTaxTreatment("EXENTO")).toEqual({ kind: "EXEMPT" });
  });

  it("a Product override always wins over the store default", () => {
    expect(resolveEffectiveTaxCategory({ productOverride: "IVA_10_5", storeDefault: "IVA_21" })).toBe("IVA_10_5");
  });

  it("falls back to the store default when the Product has no override", () => {
    expect(resolveEffectiveTaxCategory({ productOverride: null, storeDefault: "IVA_21" })).toBe("IVA_21");
  });

  it("resolves to null (never guessed) when neither is configured", () => {
    expect(resolveEffectiveTaxCategory({ productOverride: null, storeDefault: null })).toBeNull();
  });
});

describe("calculateFiscalAmounts", () => {
  it("FACTURA_C: no VAT discrimination — net equals gross, zero tax, empty breakdown, ignores line categories entirely", () => {
    const result = calculateFiscalAmounts({
      lines: [
        { grossAmount: 30_000n, taxCategory: "IVA_21" },
        { grossAmount: 20_000n, taxCategory: null }, // would be a hard error for A/B — fine for C
      ],
      documentType: "FACTURA_C",
    });
    expect(result).toEqual({
      grossAmount: 50_000n,
      netAmount: 50_000n,
      taxAmount: 0n,
      exemptAmount: 0n,
      taxBreakdown: [],
    });
  });

  it("FACTURA_A/B: decomposes a single IVA_21 line and never alters the gross amount", () => {
    const resultA = calculateFiscalAmounts({
      lines: [{ grossAmount: 121_000n, taxCategory: "IVA_21" }],
      documentType: "FACTURA_A",
    });
    expect(resultA.grossAmount).toBe(121_000n);
    expect(resultA.netAmount + resultA.taxAmount).toBe(121_000n);
    expect(resultA.exemptAmount).toBe(0n);
    expect(resultA.taxBreakdown).toEqual([
      { rateBasisPoints: 2100, baseAmount: resultA.netAmount, taxAmount: resultA.taxAmount },
    ]);

    const resultB = calculateFiscalAmounts({
      lines: [{ grossAmount: 121_000n, taxCategory: "IVA_21" }],
      documentType: "FACTURA_B",
    });
    expect(resultB).toEqual(resultA);
  });

  it("multi-rate: aggregates distinct rates into separate breakdown groups, never one entry per line", () => {
    // Item A gross $121.00 -> VAT 21%; Item B gross $110.50 -> VAT 10.5%;
    // a second IVA_21 line must MERGE into the same 21% group, not produce
    // a duplicate.
    const result = calculateFiscalAmounts({
      lines: [
        { grossAmount: 12_100n, taxCategory: "IVA_21" },
        { grossAmount: 11_050n, taxCategory: "IVA_10_5" },
        { grossAmount: 6_050n, taxCategory: "IVA_21" },
      ],
      documentType: "FACTURA_A",
    });

    expect(result.taxBreakdown).toHaveLength(2); // exactly 2 distinct rates, not 3 lines
    const byRate = new Map(result.taxBreakdown.map((entry) => [entry.rateBasisPoints, entry]));
    expect(byRate.get(2100)!.baseAmount + byRate.get(2100)!.taxAmount).toBe(12_100n + 6_050n);
    expect(byRate.get(1050)).toBeDefined();

    // The authoritative invariant: net + tax + exempt === gross, exactly.
    expect(result.netAmount + result.taxAmount + result.exemptAmount).toBe(result.grossAmount);
  });

  it("EXENTO lines contribute to exemptAmount, never to taxBreakdown or taxAmount", () => {
    const result = calculateFiscalAmounts({
      lines: [
        { grossAmount: 10_000n, taxCategory: "IVA_21" },
        { grossAmount: 5_000n, taxCategory: "EXENTO" },
      ],
      documentType: "FACTURA_B",
    });
    expect(result.exemptAmount).toBe(5_000n);
    expect(result.taxBreakdown).toHaveLength(1);
    expect(result.netAmount + result.taxAmount + result.exemptAmount).toBe(15_000n);
  });

  it("FACTURA_A/B throws MissingLineTaxCategoryError rather than guessing 21% when a line has no category", () => {
    expect(() =>
      calculateFiscalAmounts({
        lines: [{ grossAmount: 10_000n, taxCategory: null }],
        documentType: "FACTURA_B",
      }),
    ).toThrow(MissingLineTaxCategoryError);
  });

  it("rejects a negative total with a deliberate domain error", () => {
    expect(() =>
      calculateFiscalAmounts({ lines: [{ grossAmount: -1n, taxCategory: "IVA_21" }], documentType: "FACTURA_B" }),
    ).toThrow(UnsupportedFiscalScenarioError);
  });

  it("the customer-facing total is never inflated: gross stays whatever the Sale's own total already was", () => {
    // The exact scenario this phase's spec explicitly forbids: a
    // $100.000 catalog price must never become $121.000 at checkout.
    const catalogPrice = 10_000_000n; // $100.000,00 in minor units
    const result = calculateFiscalAmounts({
      lines: [{ grossAmount: catalogPrice, taxCategory: "IVA_21" }],
      documentType: "FACTURA_A",
    });
    expect(result.grossAmount).toBe(catalogPrice);
  });

  it("sum-of-components invariant holds for an arbitrary multi-line, multi-rate, multi-exempt Sale", () => {
    const lines: Array<{ grossAmount: bigint; taxCategory: "IVA_21" | "IVA_10_5" | "IVA_27" | "IVA_5" | "IVA_2_5" | "IVA_0" | "EXENTO" }> = [
      { grossAmount: 123_457n, taxCategory: "IVA_21" },
      { grossAmount: 98_765n, taxCategory: "IVA_10_5" },
      { grossAmount: 1n, taxCategory: "IVA_27" },
      { grossAmount: 7_777n, taxCategory: "IVA_5" },
      { grossAmount: 4_321n, taxCategory: "IVA_2_5" },
      { grossAmount: 999n, taxCategory: "IVA_0" },
      { grossAmount: 55_555n, taxCategory: "EXENTO" },
    ];
    const result = calculateFiscalAmounts({ lines, documentType: "FACTURA_A" });
    const expectedGross = lines.reduce((sum, l) => sum + l.grossAmount, 0n);
    expect(result.grossAmount).toBe(expectedGross);
    expect(result.netAmount + result.taxAmount + result.exemptAmount).toBe(expectedGross);
    // 6 distinct TAXABLE rates present (21, 10.5, 27, 5, 2.5, 0 — IVA_0 is
    // still its own taxBreakdown group, distinct from EXENTO, which never
    // appears in taxBreakdown at all).
    expect(result.taxBreakdown).toHaveLength(6);
  });
});

describe("ARCA code-mapping layer — every domain value maps to a real ARCA code", () => {
  it("CbteTipo codes match the WSFEv1 manual (A=1, B=6, C=11)", () => {
    expect(ARCA_CBTE_TIPO_CODE).toEqual({ FACTURA_A: 1, FACTURA_B: 6, FACTURA_C: 11 });
  });

  it("DocTipo codes match the WSFEv1 manual (CUIT=80, DNI=96, sin identificar=99)", () => {
    expect(ARCA_DOC_TIPO_CODE).toEqual({ CUIT: 80, DNI: 96, CONSUMIDOR_FINAL_SIN_IDENTIFICAR: 99 });
  });

  it("every RecipientVatCondition this codebase models has a CondicionIVAReceptorId code", () => {
    const modeled: Array<keyof typeof ARCA_CONDICION_IVA_RECEPTOR_CODE> = [
      "RESPONSABLE_INSCRIPTO",
      "MONOTRIBUTISTA",
      "EXENTO",
      "CONSUMIDOR_FINAL",
      "IVA_NO_ALCANZADO",
    ];
    for (const condition of modeled) {
      expect(typeof ARCA_CONDICION_IVA_RECEPTOR_CODE[condition]).toBe("number");
    }
  });
});

describe("buildWsfeInvoiceRequest — pure request construction, no network", () => {
  it("maps a Factura B / Consumidor Final / no-identification Sale correctly", () => {
    const fiscalCalculation = calculateFiscalAmounts({
      lines: [{ grossAmount: 121_000n, taxCategory: "IVA_21" }],
      documentType: "FACTURA_B",
    });
    const request = buildWsfeInvoiceRequest({
      documentType: "FACTURA_B",
      voucherNumber: 42,
      issuer: { pointOfSale: 3 },
      customer: {
        documentKind: "CONSUMIDOR_FINAL_SIN_IDENTIFICAR",
        documentNumber: null,
        vatCondition: "CONSUMIDOR_FINAL",
      },
      sale: { saleDate: new Date("2026-08-18T12:00:00Z") },
      fiscalCalculation,
    });

    expect(request.CbteTipo).toBe(6);
    expect(request.PtoVta).toBe(3);
    expect(request.Concepto).toBe(1);
    expect(request.DocTipo).toBe(99);
    expect(request.DocNro).toBe("0");
    expect(request.CbteFch).toBe("20260818");
    expect(request.ImpTotal).toBeCloseTo(1210, 5);
    expect(request.ImpNeto + request.ImpIVA).toBeCloseTo(request.ImpTotal, 5);
    expect(request.MonId).toBe("PES");
    expect(request.CondicionIVAReceptorId).toBe(5);
    expect(request.CbteDesde).toBe(42);
    expect(request.CbteHasta).toBe(42);
    expect(request.Iva).toHaveLength(1);
    expect(request.Iva[0].Id).toBe(5);
  });

  it("Factura C carries an empty Iva array and ImpIVA of 0", () => {
    const fiscalCalculation = calculateFiscalAmounts({
      lines: [{ grossAmount: 50_000n, taxCategory: null }],
      documentType: "FACTURA_C",
    });
    const request = buildWsfeInvoiceRequest({
      documentType: "FACTURA_C",
      voucherNumber: 1,
      issuer: { pointOfSale: 1 },
      customer: { documentKind: "DNI", documentNumber: "30123456", vatCondition: "CONSUMIDOR_FINAL" },
      sale: { saleDate: new Date("2026-08-18T12:00:00Z") },
      fiscalCalculation,
    });

    expect(request.Iva).toHaveLength(0);
    expect(request.ImpIVA).toBe(0);
    expect(request.DocTipo).toBe(96);
    expect(request.DocNro).toBe("30123456");
  });

  it("multi-rate Factura B: aggregates two distinct rates into two Iva entries, and routes EXENTO into ImpOpEx", () => {
    const fiscalCalculation = calculateFiscalAmounts({
      lines: [
        { grossAmount: 12_100n, taxCategory: "IVA_21" },
        { grossAmount: 11_050n, taxCategory: "IVA_10_5" },
        { grossAmount: 5_000n, taxCategory: "EXENTO" },
      ],
      documentType: "FACTURA_B",
    });
    const request = buildWsfeInvoiceRequest({
      documentType: "FACTURA_B",
      voucherNumber: 7,
      issuer: { pointOfSale: 1 },
      customer: { documentKind: "DNI", documentNumber: "30123456", vatCondition: "CONSUMIDOR_FINAL" },
      sale: { saleDate: new Date("2026-08-18T12:00:00Z") },
      fiscalCalculation,
    });

    expect(request.Iva).toHaveLength(2);
    const ids = request.Iva.map((entry) => entry.Id).sort();
    expect(ids).toEqual([4, 5]); // 10.5% and 21%
    expect(request.ImpOpEx).toBeCloseTo(50, 5); // 5_000n minor units -> 50.00
  });
});
