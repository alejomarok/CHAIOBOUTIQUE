// Pure — no "server-only", no DB import. Implements the "Consumidor Final
// identification threshold" rule as a single, named, documented piece of
// logic (this phase's explicit "not scattered hardcoded UI logic"
// requirement) rather than an inline check wherever a Sale total happens to
// be available.
//
// OFFICIAL RULE / SOURCE: RG (ARCA) 5700/2025 — a Consumidor Final may be
// invoiced without providing identification (DocTipo 99, "Consumidor Final
// sin identificar") only while the invoice's total amount is below
// ARS 10.000.000. At or above that amount, the recipient must be identified
// by DNI or CUIT (DocTipo 96/80). This superseded the older, IPC-indexed
// threshold under RG 1415/2003. This is a real, currently-in-force legal
// figure — not a CHAIOBOUTIQUE business preference — so it is a SINGLE
// named, structured definition in this one place (never duplicated as a
// bare literal in UI/business/provider code — see this phase's explicit
// "do not duplicate the threshold constant" correction); a future change to
// the legal figure (thresholds like this are periodically re-indexed) is a
// one-place edit here.
import type { RecipientVatCondition } from "@/generated/prisma/client";

import { RecipientFiscalDataRequiredError } from "./document-type-core";

export interface FiscalThresholdDefinition {
  amountMinorUnits: bigint;
  // ISO date the resolution took effect — not merely "when it was signed"
  // (a resolution can be published before it applies).
  effectiveDate: string;
  source: string;
}

// ARS 10.000.000, expressed in minor units (centavos) per this codebase's
// BigInt money convention (see lib/money.ts). Effective date verified via
// independent secondary sources during the ARCA Fiscal Readiness
// correction pass (a resolution's own official Boletín Oficial text was
// not directly fetched — treat as corroborated, not primary-source
// certain).
export const CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD: FiscalThresholdDefinition = {
  amountMinorUnits: 1_000_000_000n,
  effectiveDate: "2025-05-29",
  source: "RG (ARCA) 5700/2025 — Identificación del Consumidor Final",
};

// Kept as a separate named export (not just a property access) so call
// sites reading the bare BigInt never need to know this is backed by a
// structured definition — same value, single source.
export const CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD_MINOR_UNITS =
  CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD.amountMinorUnits;

export function requiresRecipientIdentification(saleTotalAmountMinorUnits: bigint): boolean {
  return saleTotalAmountMinorUnits >= CONSUMIDOR_FINAL_IDENTIFICATION_THRESHOLD.amountMinorUnits;
}

export interface ResolveRecipientVatConditionInput {
  // Customer.vatCondition, when the admin has explicitly set it — always
  // wins outright; this function never overrides an explicit choice.
  explicitVatCondition: RecipientVatCondition | null;
  // Whether the Customer has a real documentNumber or taxId on file — never
  // re-derived from anything else (a name alone is not identification).
  hasIdentification: boolean;
  saleTotalAmountMinorUnits: bigint;
}

// Never guesses: an unclassified customer either qualifies as Consumidor
// Final (below the threshold, or already identified) or this throws —
// there is no silent third option.
export function resolveRecipientVatCondition(
  input: ResolveRecipientVatConditionInput,
): RecipientVatCondition {
  if (input.explicitVatCondition) return input.explicitVatCondition;

  if (requiresRecipientIdentification(input.saleTotalAmountMinorUnits) && !input.hasIdentification) {
    throw new RecipientFiscalDataRequiredError(
      "el importe de la venta requiere identificar al cliente (DNI o CUIT) por Resolución General 5700/2025",
    );
  }

  return "CONSUMIDOR_FINAL";
}
