// Pure — no "server-only", no DB import. See this phase's "CRITICAL RULE:
// DO NOT GUESS CHAIOBOUTIQUE'S TAX CONDITION" instruction: this function
// NEVER assumes a default issuer/recipient condition — every branch either
// resolves to a real FiscalInvoiceType or throws one of the two errors
// below. Never silently falls back to Factura B/21% IVA.
//
// SOURCE: WSFEv1 Manual para el Desarrollador — issuer condition determines
// which CbteTipo the issuer's CUIT is even authorized to request; a
// Responsable Inscripto issuer selects A vs. B by the RECIPIENT's own
// condition (A only when the recipient is also Responsable Inscripto — the
// point of Factura A is inter-company VAT credit, which only a fellow
// Responsable Inscripto can use). A Monotributista or Exento issuer can
// only ever emit Factura C, regardless of who the recipient is (neither
// discriminates VAT on their invoices at all).
import type { IssuerVatCondition, RecipientVatCondition } from "@/generated/prisma/client";

import type { FiscalInvoiceType } from "./arca-codes";

export class IssuerFiscalProfileIncompleteError extends Error {
  constructor(missingField: string) {
    super(`Falta completar la configuración fiscal del emisor: ${missingField}.`);
    this.name = "IssuerFiscalProfileIncompleteError";
  }
}

export class RecipientFiscalDataRequiredError extends Error {
  constructor(reason: string) {
    super(`El cliente requiere información fiscal para facturar: ${reason}.`);
    this.name = "RecipientFiscalDataRequiredError";
  }
}

export interface ResolveFiscalDocumentTypeInput {
  issuerVatCondition: IssuerVatCondition | null;
  recipientVatCondition: RecipientVatCondition | null;
}

// Pure — never touches Prisma/Sale/Customer directly, so it stays trivially
// unit-testable. Callers (readiness-core.ts, the future WSFE request path)
// are responsible for resolving `issuerVatCondition` from
// StoreConfiguration and `recipientVatCondition` from Customer/the
// Consumidor Final threshold rule (see consumer-final-core.ts) BEFORE
// calling this — this function itself never reads anything, and never
// invents a value for either.
export function resolveFiscalDocumentType(input: ResolveFiscalDocumentTypeInput): FiscalInvoiceType {
  if (!input.issuerVatCondition) {
    throw new IssuerFiscalProfileIncompleteError("condición frente al IVA del emisor");
  }
  if (!input.recipientVatCondition) {
    throw new RecipientFiscalDataRequiredError("condición frente al IVA no determinada");
  }

  switch (input.issuerVatCondition) {
    case "MONOTRIBUTISTA":
    case "EXENTO":
      return "FACTURA_C";
    case "RESPONSABLE_INSCRIPTO":
      return input.recipientVatCondition === "RESPONSABLE_INSCRIPTO" ? "FACTURA_A" : "FACTURA_B";
  }
}
