// Pure — no "server-only", no DB import. Resolves WHICH kind of
// identification document (CUIT/DNI/none) a real WSFEv1 FECAESolicitar
// request sends for a given recipient, from already-loaded Customer
// fields — never guessed: a registered VAT condition (anything but
// CONSUMIDOR_FINAL) with no real taxId/documentNumber on file throws, the
// same posture as resolveRecipientVatCondition's own identification-
// threshold rule (see consumer-final-core.ts). Kept as a separate, small,
// pure resolver (not folded into consumer-final-core.ts, which only ever
// decides the recipient's VAT CONDITION, not their document identification
// — a genuinely different decision) so both stay trivially unit-testable.
import type { RecipientVatCondition } from "@/generated/prisma/client";

import type { ArcaReceptorDocKind } from "./arca-codes";
import { RecipientFiscalDataRequiredError } from "./document-type-core";

export interface ResolveRecipientDocumentInput {
  vatCondition: RecipientVatCondition;
  // Already-normalized (digits-only) values — see Customer.taxIdNormalized/
  // documentNumberNormalized's own schema comments. Never re-derived here.
  taxIdNormalized: string | null;
  documentNumberNormalized: string | null;
}

export interface RecipientDocumentIdentification {
  documentKind: ArcaReceptorDocKind;
  documentNumber: string | null;
}

// Precedence: a CUIT on file always wins (it's the more specific fiscal
// identifier); otherwise a DNI; otherwise — ONLY for a genuine Consumidor
// Final — ARCA's own "sin identificar" convention. Any OTHER VAT condition
// (Responsable Inscripto/Monotributista/Exento/IVA no alcanzado) with no
// real identification on file is a real data gap, never silently treated
// as an anonymous Consumidor Final.
export function resolveRecipientDocumentIdentification(
  input: ResolveRecipientDocumentInput,
): RecipientDocumentIdentification {
  if (input.taxIdNormalized) {
    return { documentKind: "CUIT", documentNumber: input.taxIdNormalized };
  }
  if (input.documentNumberNormalized) {
    return { documentKind: "DNI", documentNumber: input.documentNumberNormalized };
  }
  if (input.vatCondition === "CONSUMIDOR_FINAL") {
    return { documentKind: "CONSUMIDOR_FINAL_SIN_IDENTIFICAR", documentNumber: null };
  }
  throw new RecipientFiscalDataRequiredError(
    "el cliente no tiene CUIT ni documento cargado, requerido para su condición frente al IVA",
  );
}
