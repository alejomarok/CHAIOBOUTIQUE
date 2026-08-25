// Node-safe core: no "server-only" import — mirrors every other -core.ts
// module in this codebase. Reads StoreConfiguration/Sale/Customer (real DB
// access, so this is NOT unit-testable without Prisma — covered by
// integration tests instead, same posture as fiscal-document-core.ts
// itself).
//
// Implements this phase's explicit "DATA READY" vs. "CONNECTION READY"
// distinction (section 24: "Do not confuse the two"):
//   - getArcaDataReadiness(): does StoreConfiguration have enough real
//     fiscal identity to determine a document type at all? Gates
//     createArcaInvoicingIntent (see fiscal-document-core.ts) — data
//     readiness alone, deliberately still NOT gated on connection
//     readiness: an admin can register the INTENT to invoice electronically
//     before a real certificate is configured, then actually issue once
//     connection readiness is also met (see issue-electronic-invoice-core.ts's
//     own, separate full-readiness gate for the real issuance action).
//   - getArcaConnectionReadiness(): Phase — ARCA Homologation: Real WSAA +
//     WSFEv1 Integration. Now a REAL, async check: environment must be
//     explicitly HOMOLOGATION (never PRODUCTION — this codebase never
//     implements the production posture), and the configured certificate/
//     private key (see certificate-core.ts) must exist, be readable, be
//     parseable, and not be expired. Never exposes certificate/key secret
//     material — only booleans/labels/dates, same posture as
//     getMercadoPagoReadiness.
//   - getArcaReadinessForSale(): the per-Sale composite used by the Sale
//     detail page — store-level DATA readiness plus this specific Sale's
//     own recipient-identification/document-type resolvability. Still
//     deliberately DATA-only (see above).
import { env } from "@/lib/env-core";
import { prisma } from "@/lib/db-core";

import { getStoreConfiguration } from "@/modules/store-settings/service-core";

import {
  ArcaCertificateInvalidError,
  ArcaCertificateUnreadableError,
  getArcaCertificateInfo,
  loadArcaCertificateConfig,
} from "./certificate-core";
import {
  IssuerFiscalProfileIncompleteError,
  RecipientFiscalDataRequiredError,
  resolveFiscalDocumentType,
} from "./document-type-core";
import { resolveRecipientVatCondition } from "./consumer-final-core";

export class SaleNotFoundError extends Error {
  constructor() {
    super("Venta no encontrada.");
    this.name = "SaleNotFoundError";
  }
}

export interface ArcaReadinessBlocker {
  code: string;
  message: string;
}

export interface ArcaReadinessResult {
  ready: boolean;
  blockers: ArcaReadinessBlocker[];
}

// Store-level fiscal identity only — never touches a specific Sale/
// Customer. Used both standalone (the admin Settings readiness card) and
// as the first half of getArcaReadinessForSale below.
export async function getArcaDataReadiness(): Promise<ArcaReadinessResult> {
  const config = await getStoreConfiguration();
  const blockers: ArcaReadinessBlocker[] = [];

  if (!config.fiscalLegalName?.trim()) {
    blockers.push({ code: "MISSING_LEGAL_NAME", message: "Falta la razón social del emisor." });
  }
  if (!config.fiscalTaxId?.trim()) {
    blockers.push({ code: "MISSING_TAX_ID", message: "Falta el CUIT del emisor." });
  }
  if (!config.issuerVatCondition) {
    blockers.push({ code: "MISSING_ISSUER_VAT_CONDITION", message: "Falta la condición frente al IVA del emisor." });
  }
  if (!config.arcaPointOfSale) {
    blockers.push({ code: "MISSING_POINT_OF_SALE", message: "Falta configurar el punto de venta electrónico." });
  }
  if (!config.arcaEnvironment) {
    blockers.push({
      code: "MISSING_ENVIRONMENT",
      message: "Falta elegir el entorno de ARCA (Homologación o Producción).",
    });
  }

  return { ready: blockers.length === 0, blockers };
}

// In-process test override — same "setXForTesting" DI convention as every
// other provider singleton in this directory (see e.g.
// setArcaAuthProviderForTesting), needed because this specific check reads
// real files off disk: a vitest integration test wanting to exercise the
// real issueElectronicInvoice() flow against Fake WSAA/WSFEv1 providers
// still needs a way to report "connection ready" without an actual
// certificate on disk.
let connectionReadinessOverride: ArcaReadinessResult | null = null;

export function setArcaConnectionReadinessForTesting(result: ArcaReadinessResult | null): void {
  connectionReadinessOverride = result;
}

// Real, async check — see this module's own header comment. Every blocker
// code here is genuinely distinguishable in the admin UI: which one thing
// is actually missing/wrong, never a single generic "not ready" message.
export async function getArcaConnectionReadiness(): Promise<ArcaReadinessResult> {
  if (connectionReadinessOverride) return connectionReadinessOverride;
  // E2E_TEST_MODE consistently swaps the WHOLE ARCA integration surface for
  // its Fake counterparts (see auth-provider-core.ts's/
  // electronic-invoice-provider-core.ts's own getArca*Provider() — both
  // already select Fake under this same flag) — this mirrors
  // modules/storage's own e2e-provider.ts posture: an e2e test never has a
  // real certificate on disk (nor should it), so the readiness story this
  // function tells must agree with the providers actually being used,
  // letting a real Playwright test exercise the "Emitir en ARCA —
  // Homologación" UI end-to-end without any real ARCA credentials.
  if (env.E2E_TEST_MODE) {
    return { ready: true, blockers: [] };
  }

  const config = await getStoreConfiguration();
  const blockers: ArcaReadinessBlocker[] = [];

  if (config.arcaEnvironment !== "HOMOLOGATION") {
    blockers.push({
      code: "ENVIRONMENT_NOT_HOMOLOGATION",
      message:
        config.arcaEnvironment === "PRODUCTION"
          ? "El entorno de ARCA está configurado en Producción — esta versión solo opera en Homologación."
          : "Falta elegir el entorno de Homologación de ARCA.",
    });
  }

  const certificateConfig = loadArcaCertificateConfig();
  if (!certificateConfig) {
    blockers.push({ code: "MISSING_CERTIFICATE", message: "Certificado ARCA todavía no configurado." });
  } else {
    try {
      const info = await getArcaCertificateInfo();
      if (info.isExpired) {
        blockers.push({
          code: "CERTIFICATE_EXPIRED",
          message: `El certificado ARCA venció el ${info.notAfter.toLocaleDateString("es-AR")}.`,
        });
      }
    } catch (error) {
      if (error instanceof ArcaCertificateUnreadableError) {
        blockers.push({ code: "CERTIFICATE_UNREADABLE", message: error.message });
      } else if (error instanceof ArcaCertificateInvalidError) {
        blockers.push({ code: "CERTIFICATE_INVALID", message: error.message });
      } else {
        throw error;
      }
    }
  }

  return { ready: blockers.length === 0, blockers };
}

// The composite check the Sale detail page's "Facturación electrónica
// ARCA" section uses (section 25) — DATA readiness only, deliberately
// never gated on connection readiness (see this module's header comment).
export async function getArcaReadinessForSale(saleId: string): Promise<ArcaReadinessResult> {
  const [dataReadiness, sale, config] = await Promise.all([
    getArcaDataReadiness(),
    prisma.sale.findUnique({ where: { id: saleId }, include: { customer: true } }),
    getStoreConfiguration(),
  ]);
  if (!sale) throw new SaleNotFoundError();

  const blockers = [...dataReadiness.blockers];

  let recipientVatCondition = sale.customer.vatCondition;
  if (!recipientVatCondition) {
    try {
      recipientVatCondition = resolveRecipientVatCondition({
        explicitVatCondition: sale.customer.vatCondition,
        hasIdentification: Boolean(sale.customer.documentNumber?.trim() || sale.customer.taxId?.trim()),
        saleTotalAmountMinorUnits: sale.totalAmount,
      });
    } catch (error) {
      if (error instanceof RecipientFiscalDataRequiredError) {
        blockers.push({ code: "RECIPIENT_IDENTIFICATION_REQUIRED", message: error.message });
      } else {
        throw error;
      }
    }
  }

  if (blockers.length === 0) {
    try {
      resolveFiscalDocumentType({
        issuerVatCondition: config.issuerVatCondition,
        recipientVatCondition,
      });
    } catch (error) {
      if (error instanceof IssuerFiscalProfileIncompleteError || error instanceof RecipientFiscalDataRequiredError) {
        blockers.push({ code: "DOCUMENT_TYPE_UNRESOLVED", message: error.message });
      } else {
        throw error;
      }
    }
  }

  return { ready: blockers.length === 0, blockers };
}
