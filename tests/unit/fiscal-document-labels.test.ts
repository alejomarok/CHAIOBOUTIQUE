import { describe, expect, it } from "vitest";

import { deriveSaleInvoicingStatus } from "@/modules/fiscal-documents/invoicing-status";
import { formatFiscalDocumentIdentifier } from "@/modules/fiscal-documents/labels";

describe("deriveSaleInvoicingStatus", () => {
  it("returns NOT_INVOICED when there is no active document", () => {
    expect(deriveSaleInvoicingStatus(null)).toBe("NOT_INVOICED");
  });

  it("maps PENDING/ISSUED/ERROR through unchanged", () => {
    expect(deriveSaleInvoicingStatus({ status: "PENDING" })).toBe("PENDING");
    expect(deriveSaleInvoicingStatus({ status: "ISSUED" })).toBe("INVOICED");
    expect(deriveSaleInvoicingStatus({ status: "ERROR" })).toBe("ERROR");
  });

  it("never conflates PAID/CONFIRMED with INVOICED — this is purely the FiscalDocument's own status", () => {
    // A Sale can be CONFIRMED and PAID with zero fiscal documents — this
    // function only ever looks at what it's handed, never at Sale itself.
    expect(deriveSaleInvoicingStatus(null)).toBe("NOT_INVOICED");
  });
});

describe("formatFiscalDocumentIdentifier", () => {
  it("returns null when there is no document number yet (an ARCA PENDING intent)", () => {
    expect(
      formatFiscalDocumentIdentifier({ documentType: null, pointOfSale: null, documentNumber: null }),
    ).toBeNull();
  });

  it("joins type, point of sale and number verbatim — never reformats/pads", () => {
    expect(
      formatFiscalDocumentIdentifier({
        documentType: "Factura B",
        pointOfSale: "0004",
        documentNumber: "00001234",
      }),
    ).toBe("Factura B 0004-00001234");
  });

  it("omits the point-of-sale dash when none was provided", () => {
    expect(
      formatFiscalDocumentIdentifier({ documentType: "Recibo", pointOfSale: null, documentNumber: "55" }),
    ).toBe("Recibo 55");
  });
});
