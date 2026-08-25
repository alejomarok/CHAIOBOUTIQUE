import { describe, expect, it } from "vitest";

import { resolveRecipientDocumentIdentification } from "@/modules/fiscal-documents/arca/recipient-document-core";
import { RecipientFiscalDataRequiredError } from "@/modules/fiscal-documents/arca/document-type-core";

describe("resolveRecipientDocumentIdentification", () => {
  it("prefers a CUIT over a DNI when both are present", () => {
    const result = resolveRecipientDocumentIdentification({
      vatCondition: "RESPONSABLE_INSCRIPTO",
      taxIdNormalized: "20123456789",
      documentNumberNormalized: "30123456",
    });
    expect(result).toEqual({ documentKind: "CUIT", documentNumber: "20123456789" });
  });

  it("falls back to a DNI when there is no CUIT", () => {
    const result = resolveRecipientDocumentIdentification({
      vatCondition: "CONSUMIDOR_FINAL",
      taxIdNormalized: null,
      documentNumberNormalized: "30123456",
    });
    expect(result).toEqual({ documentKind: "DNI", documentNumber: "30123456" });
  });

  it("resolves an unidentified Consumidor Final to ARCA's 'sin identificar' convention", () => {
    const result = resolveRecipientDocumentIdentification({
      vatCondition: "CONSUMIDOR_FINAL",
      taxIdNormalized: null,
      documentNumberNormalized: null,
    });
    expect(result).toEqual({ documentKind: "CONSUMIDOR_FINAL_SIN_IDENTIFICAR", documentNumber: null });
  });

  it("throws for a registered VAT condition with no identification on file — never treated as an anonymous Consumidor Final", () => {
    expect(() =>
      resolveRecipientDocumentIdentification({
        vatCondition: "RESPONSABLE_INSCRIPTO",
        taxIdNormalized: null,
        documentNumberNormalized: null,
      }),
    ).toThrow(RecipientFiscalDataRequiredError);
  });

  it("throws for MONOTRIBUTISTA/EXENTO/IVA_NO_ALCANZADO with no identification either", () => {
    for (const vatCondition of ["MONOTRIBUTISTA", "EXENTO", "IVA_NO_ALCANZADO"] as const) {
      expect(() =>
        resolveRecipientDocumentIdentification({
          vatCondition,
          taxIdNormalized: null,
          documentNumberNormalized: null,
        }),
      ).toThrow(RecipientFiscalDataRequiredError);
    }
  });
});
