// Node-safe core: no "server-only" import — mirrors modules/sales/
// sale-core.ts's exact -core/wrapper split. Lives inside modules/
// fiscal-documents/arca/ (not modules/fiscal-documents/fiscal-document-
// core.ts) and must never import FROM fiscal-document-core.ts — that
// module already imports from this directory (readiness-core.ts), so the
// dependency direction only ever goes fiscal-document-core.ts -> arca/,
// never the reverse; the admin Server Action layer (actions.ts) imports
// both independently instead.
//
// =============================================================================
// Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration. Replaces the
// prior phase's deliberately-throwing stub with the real flow: resolve
// document type + recipient identification, compute the fiscal
// decomposition, acquire a WSAA ticket, resolve the next correlative
// voucher number from ARCA's OWN authority, request a CAE, and persist
// exactly what ARCA returned — nothing fabricated, ever.
//
// CONCURRENCY / NUMBERING-RACE STRATEGY (sections 18-19): a single
// Postgres advisory transaction lock, keyed by (pointOfSale, CbteTipo),
// wraps the ENTIRE "resolve last voucher -> build request -> request CAE
// -> persist" critical section. This serializes:
//   - two admins double-clicking "Emitir" for the SAME Sale (same
//     pointOfSale+CbteTipo as any other Sale sharing that voucher stream),
//   - two DIFFERENT Sales being issued concurrently against the same
//     pointOfSale+CbteTipo (the genuine numbering race this phase's own
//     spec calls out),
//   - a network retry racing a still-in-flight original attempt.
// pg_advisory_xact_lock is a DATABASE-level lock (not an in-process one),
// so this correctly serializes across multiple Node processes too — unlike
// the WSAA ticket cache (see wsaa-ticket-cache-core.ts's own documented
// in-process-only limitation), this protection is NOT process-bound.
// Holding the lock (and the surrounding DB transaction) open across the
// real WSFEv1 network round-trip is a deliberate trade-off: correctness
// over throughput, appropriate for a single small retail store's realistic
// issuance volume (a handful of invoices at a time, never a high-frequency
// batch) — see the transaction's own explicit extended timeout below.
//
// IDEMPOTENCY (section 18): reuses the SAME FiscalDocument row created by
// createArcaInvoicingIntent (fiscal-document-core.ts) end to end — this
// flow only ever UPDATES that PENDING/ERROR row to ISSUED/ERROR, never
// creates a second row, preserving the existing
// fiscal_document_sale_active_unique partial-unique-index invariant. A
// retried call against an already-ISSUED row is a safe no-op (returns the
// existing row, never a second CAE request).
import type { FiscalDocument } from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";
import { getStoreConfiguration } from "@/modules/store-settings/service-core";

import { ARCA_CBTE_TIPO_CODE, FISCAL_INVOICE_TYPE_LABELS_ES, type FiscalInvoiceType } from "./arca-codes";
import { getArcaAuthProvider } from "./auth-provider-core";
import { resolveRecipientVatCondition } from "./consumer-final-core";
import { resolveFiscalDocumentType } from "./document-type-core";
import {
  getArcaElectronicInvoiceProvider,
  type WsfeCaeResult,
  type WsfeObservation,
} from "./electronic-invoice-provider-core";
import { getArcaConnectionReadiness, SaleNotFoundError } from "./readiness-core";
import { resolveRecipientDocumentIdentification } from "./recipient-document-core";
import { calculateFiscalAmounts, type FiscalCalculationResult } from "./tax-calculation-core";
import { validateWsfeRequestReadiness } from "./wsfe-validation-core";
import { buildWsfeInvoiceRequest } from "./wsfe-request-builder-core";

export { SaleNotFoundError };

export class ArcaIssuanceNotReadyError extends Error {
  constructor(blockerMessages: string[]) {
    super(`No se puede emitir el comprobante electrónico: ${blockerMessages.join(" ")}`);
    this.name = "ArcaIssuanceNotReadyError";
  }
}

export class NoPendingArcaIntentError extends Error {
  constructor() {
    super("No hay una intención de facturación electrónica ARCA pendiente para esta venta.");
    this.name = "NoPendingArcaIntentError";
  }
}

// Thrown when the CAE request itself couldn't be confirmed either way
// (network failure, timeout) — genuinely different from a REJECTED
// outcome (which IS a confirmed answer from ARCA). The FiscalDocument is
// left PENDING with the attempted voucher number recorded; see
// reconcileArcaFiscalDocument below for the safe way to resolve this
// afterward — NEVER simply retried blindly, which risks a duplicate CAE
// request for a voucher ARCA may have already authorized.
export class ArcaIssuanceUncertainError extends Error {
  constructor(public readonly fiscalDocumentId: string) {
    super(
      "No pudimos confirmar si ARCA procesó la solicitud (posible falla de red). " +
        "Usá 'Verificar estado en ARCA' antes de reintentar — no vuelvas a intentar emitir directamente.",
    );
    this.name = "ArcaIssuanceUncertainError";
  }
}

export class FiscalDocumentNotReconcilableError extends Error {
  constructor() {
    super("Este comprobante no tiene una emisión electrónica pendiente para verificar.");
    this.name = "FiscalDocumentNotReconcilableError";
  }
}

export class FiscalDocumentNotFoundError extends Error {
  constructor() {
    super("Comprobante fiscal no encontrado.");
    this.name = "FiscalDocumentNotFoundError";
  }
}

interface IssuanceContext {
  saleId: string;
  saleDate: Date;
  saleTotalAmount: bigint;
  documentType: FiscalInvoiceType;
  documentTypeCode: number;
  pointOfSale: number;
  cuit: string;
  customerVatCondition: ReturnType<typeof resolveRecipientVatCondition>;
  documentKind: ReturnType<typeof resolveRecipientDocumentIdentification>["documentKind"];
  customerDocumentNumber: string | null;
  fiscalCalculation: FiscalCalculationResult;
}

// Deterministic, side-effect-free beyond its own DB reads — safe to call
// repeatedly (used by both issueElectronicInvoice and
// reconcileArcaFiscalDocument) since it NEVER calls WSAA/WSFEv1 itself and
// never writes anything. Every value resolved here is derived purely from
// already-confirmed historical Sale/Customer/StoreConfiguration data, so
// re-deriving it twice (once pre-flight, once inside the locked
// transaction) is safe and cheap — no external call to memoize.
async function resolveIssuanceContext(saleId: string): Promise<IssuanceContext> {
  const [sale, config] = await Promise.all([
    prisma.sale.findUnique({ where: { id: saleId }, include: { customer: true, items: true } }),
    getStoreConfiguration(),
  ]);
  if (!sale) throw new SaleNotFoundError();

  const customerVatCondition = resolveRecipientVatCondition({
    explicitVatCondition: sale.customer.vatCondition,
    hasIdentification: Boolean(sale.customer.documentNumber?.trim() || sale.customer.taxId?.trim()),
    saleTotalAmountMinorUnits: sale.totalAmount,
  });
  const documentType = resolveFiscalDocumentType({
    issuerVatCondition: config.issuerVatCondition,
    recipientVatCondition: customerVatCondition,
  });
  const { documentKind, documentNumber } = resolveRecipientDocumentIdentification({
    vatCondition: customerVatCondition,
    taxIdNormalized: sale.customer.taxIdNormalized,
    documentNumberNormalized: sale.customer.documentNumberNormalized,
  });

  const fiscalCalculation = calculateFiscalAmounts({
    documentType,
    lines: sale.items.map((item) => ({ grossAmount: item.totalAmount, taxCategory: item.taxCategory })),
  });

  return {
    saleId: sale.id,
    saleDate: sale.saleDate,
    saleTotalAmount: sale.totalAmount,
    documentType,
    documentTypeCode: ARCA_CBTE_TIPO_CODE[documentType],
    // Non-null: guaranteed by the readiness gate every caller runs first.
    pointOfSale: config.arcaPointOfSale!,
    cuit: config.fiscalTaxId!,
    customerVatCondition,
    documentKind,
    customerDocumentNumber: documentNumber,
    fiscalCalculation,
  };
}

function advisoryLockKey(pointOfSale: number, documentTypeCode: number): string {
  return `arca-voucher:${pointOfSale}:${documentTypeCode}`;
}

function serializeTaxBreakdown(fiscalCalculation: FiscalCalculationResult) {
  return fiscalCalculation.taxBreakdown.map((entry) => ({
    rateBasisPoints: entry.rateBasisPoints,
    baseAmount: entry.baseAmount.toString(),
    taxAmount: entry.taxAmount.toString(),
  }));
}

function serializeObservations(observations: WsfeObservation[]) {
  return observations.map((o) => ({ code: o.code, message: o.message }));
}

// Discriminates the transaction's own outcome from what the CALLER should
// see. Needed specifically because throwing from inside a Prisma
// interactive-transaction callback rolls back everything the callback just
// wrote — the uncertain-outcome branch below deliberately COMMITS its
// "attempted voucher number" marker, then signals ArcaIssuanceUncertainError
// to the caller only AFTER that commit has landed (outside the
// transaction), never losing the marker to an automatic rollback.
type IssuanceTransactionResult =
  | { kind: "settled"; document: FiscalDocument }
  | { kind: "uncertain"; fiscalDocumentId: string };

// Real WSAA + WSFEv1 issuance — see this module's own header comment for
// the full concurrency/idempotency design. Extended transaction timeout
// (see prisma.$transaction's options below): this deliberately holds one
// DB transaction open across a real network round-trip to ARCA.
export async function issueElectronicInvoice(saleId: string, actorId: string): Promise<FiscalDocument> {
  // Idempotent fast path: a prior call already reached ISSUED (double-
  // click, retried Server Action) — skip readiness/WSAA/WSFEv1 entirely.
  // The transaction below has its OWN authoritative, lock-protected version
  // of this same check for the genuinely concurrent case; this is purely
  // an optimization for the common sequential-retry case.
  const preExisting = await prisma.fiscalDocument.findFirst({
    where: { saleId, status: { not: "VOIDED" } },
    orderBy: { createdAt: "desc" },
  });
  if (preExisting?.mode === "ELECTRONICA_ARCA" && preExisting.status === "ISSUED") {
    return preExisting;
  }

  const [wsfeReadiness, connectionReadiness] = await Promise.all([
    validateWsfeRequestReadiness(saleId),
    getArcaConnectionReadiness(),
  ]);
  const blockers = [...wsfeReadiness.blockers, ...connectionReadiness.blockers];
  if (blockers.length > 0) throw new ArcaIssuanceNotReadyError(blockers.map((b) => b.message));

  const context = await resolveIssuanceContext(saleId);
  if (context.fiscalCalculation.grossAmount !== context.saleTotalAmount) {
    throw new ArcaIssuanceNotReadyError([
      "el total fiscal calculado no coincide con el total de la venta — no se envía a ARCA",
    ]);
  }

  const authProvider = getArcaAuthProvider();
  const ticket = await authProvider.getToken("wsfe");
  const invoiceProvider = getArcaElectronicInvoiceProvider();

  const result = await prisma.$transaction(
    async (tx): Promise<IssuanceTransactionResult> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryLockKey(context.pointOfSale, context.documentTypeCode)}))`;

      const existing = await tx.fiscalDocument.findFirst({
        where: { saleId, status: { not: "VOIDED" } },
        orderBy: { createdAt: "desc" },
      });
      if (!existing || existing.mode !== "ELECTRONICA_ARCA") {
        throw new NoPendingArcaIntentError();
      }
      // Idempotent no-op: already issued by a prior attempt (double-click,
      // retried Server Action, or another concurrent caller that won the
      // advisory-lock race first) — never a second CAE request.
      if (existing.status === "ISSUED") {
        return { kind: "settled", document: existing };
      }

      const lastVoucher = await invoiceProvider.getLastAuthorizedVoucher(
        { pointOfSale: context.pointOfSale, documentTypeCode: context.documentTypeCode },
        ticket,
        context.cuit,
      );
      const voucherNumber = lastVoucher + 1;

      const wsfeRequest = buildWsfeInvoiceRequest({
        documentType: context.documentType,
        voucherNumber,
        issuer: { pointOfSale: context.pointOfSale },
        customer: {
          documentKind: context.documentKind,
          documentNumber: context.customerDocumentNumber,
          vatCondition: context.customerVatCondition,
        },
        sale: { saleDate: context.saleDate },
        fiscalCalculation: context.fiscalCalculation,
      });

      let caeResult: WsfeCaeResult;
      try {
        caeResult = await invoiceProvider.requestCae(wsfeRequest, ticket, context.cuit);
      } catch {
        // Uncertain outcome — leave status PENDING, but record the
        // attempted voucher number so reconcileArcaFiscalDocument has
        // something concrete to verify against ARCA later. Never marked
        // ERROR here: ERROR means "ARCA gave us a real rejection", which
        // this is not. Returned (never thrown) so this write actually
        // COMMITS — throwing here would roll back the very marker this
        // branch exists to persist; see IssuanceTransactionResult's own
        // comment.
        await tx.fiscalDocument.update({
          where: { id: existing.id },
          data: {
            pointOfSale: String(context.pointOfSale),
            documentType: FISCAL_INVOICE_TYPE_LABELS_ES[context.documentType],
            arcaResponseMetadata: {
              status: "UNCERTAIN",
              attemptedVoucherNumber: voucherNumber,
              attemptedAt: new Date().toISOString(),
            },
          },
        });
        await recordAuditLog(
          {
            userId: actorId,
            action: "fiscal_document.arca_issue_uncertain",
            entityType: "FiscalDocument",
            entityId: existing.id,
            metadata: { saleId, pointOfSale: context.pointOfSale, documentTypeCode: context.documentTypeCode, voucherNumber },
          },
          tx,
        );
        return { kind: "uncertain", fiscalDocumentId: existing.id };
      }

      if (caeResult.outcome === "REJECTED") {
        const rejected = await tx.fiscalDocument.update({
          where: { id: existing.id },
          data: {
            status: "ERROR",
            pointOfSale: String(context.pointOfSale),
            documentType: FISCAL_INVOICE_TYPE_LABELS_ES[context.documentType],
            arcaResponseMetadata: {
              status: "REJECTED",
              observations: serializeObservations(caeResult.observations),
              errors: serializeObservations(caeResult.errors),
              events: serializeObservations(caeResult.events),
            },
          },
        });
        await recordAuditLog(
          {
            userId: actorId,
            action: "fiscal_document.arca_rejected",
            entityType: "FiscalDocument",
            entityId: existing.id,
            newValue: { errors: serializeObservations(caeResult.errors) },
          },
          tx,
        );
        return { kind: "settled", document: rejected };
      }

      const issued = await tx.fiscalDocument.update({
        where: { id: existing.id },
        data: {
          status: "ISSUED",
          pointOfSale: String(context.pointOfSale),
          documentType: FISCAL_INVOICE_TYPE_LABELS_ES[context.documentType],
          documentNumber: String(caeResult.voucherNumber),
          issueDate: context.saleDate,
          netAmount: context.fiscalCalculation.netAmount,
          taxAmount: context.fiscalCalculation.taxAmount,
          exemptAmount: context.fiscalCalculation.exemptAmount,
          totalAmount: context.fiscalCalculation.grossAmount,
          cae: caeResult.cae,
          caeExpiresAt: caeResult.caeExpiresAt,
          arcaEnvironment: "HOMOLOGATION",
          arcaTaxBreakdown: serializeTaxBreakdown(context.fiscalCalculation),
          arcaResponseMetadata: {
            status: "APPROVED",
            observations: serializeObservations(caeResult.observations),
            events: serializeObservations(caeResult.events),
          },
        },
      });
      await recordAuditLog(
        {
          userId: actorId,
          action: "fiscal_document.arca_issued",
          entityType: "FiscalDocument",
          entityId: existing.id,
          newValue: { cae: issued.cae, documentNumber: issued.documentNumber, pointOfSale: issued.pointOfSale },
        },
        tx,
      );
      return { kind: "settled", document: issued };
    },
    // Real network calls happen inside this transaction — see this
    // module's own header comment for why. Generous but bounded.
    { maxWait: 10_000, timeout: 30_000 },
  );

  if (result.kind === "uncertain") {
    // The marker committed successfully (see IssuanceTransactionResult's
    // own comment) — only NOW, outside the transaction, do we surface the
    // uncertain outcome to the caller.
    throw new ArcaIssuanceUncertainError(result.fiscalDocumentId);
  }
  return result.document;
}

// Retry-safety (section 17): given a FiscalDocument left in an uncertain
// state by ArcaIssuanceUncertainError, asks ARCA DIRECTLY (via
// FECompConsultar) whether the attempted voucher was actually authorized,
// instead of blindly re-issuing. Safe to call any number of times.
export async function reconcileArcaFiscalDocument(fiscalDocumentId: string, actorId: string): Promise<FiscalDocument> {
  const doc = await prisma.fiscalDocument.findUnique({ where: { id: fiscalDocumentId } });
  if (!doc) throw new FiscalDocumentNotFoundError();
  if (doc.mode !== "ELECTRONICA_ARCA" || doc.status === "VOIDED") {
    throw new FiscalDocumentNotReconcilableError();
  }
  if (doc.status === "ISSUED") return doc;

  const metadata = doc.arcaResponseMetadata as { status?: string; attemptedVoucherNumber?: number } | null;
  if (!metadata || metadata.status !== "UNCERTAIN" || typeof metadata.attemptedVoucherNumber !== "number") {
    // Nothing was ever actually attempted against ARCA (still a fresh
    // PENDING intent, or a definitive REJECTED with no uncertain attempt
    // to verify) — safe to just issue normally instead.
    throw new FiscalDocumentNotReconcilableError();
  }

  const context = await resolveIssuanceContext(doc.saleId);
  const authProvider = getArcaAuthProvider();
  const ticket = await authProvider.getToken("wsfe");
  const invoiceProvider = getArcaElectronicInvoiceProvider();

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryLockKey(context.pointOfSale, context.documentTypeCode)}))`;

      const current = await tx.fiscalDocument.findUnique({ where: { id: fiscalDocumentId } });
      if (!current) throw new FiscalDocumentNotFoundError();
      if (current.status === "ISSUED") return current;

      const detail = await invoiceProvider.getVoucherDetail(
        {
          pointOfSale: context.pointOfSale,
          documentTypeCode: context.documentTypeCode,
          voucherNumber: metadata.attemptedVoucherNumber!,
        },
        ticket,
        context.cuit,
      );

      if (!detail.found || !detail.cae || !detail.caeExpiresAt) {
        // ARCA never authorized that number — safe to retry a fresh
        // issuance later (leave PENDING, clear the stale uncertain marker
        // so a future attempt reads as a clean first try).
        await recordAuditLog(
          {
            userId: actorId,
            action: "fiscal_document.arca_reconciled_not_found",
            entityType: "FiscalDocument",
            entityId: fiscalDocumentId,
            metadata: { attemptedVoucherNumber: metadata.attemptedVoucherNumber },
          },
          tx,
        );
        return tx.fiscalDocument.update({
          where: { id: fiscalDocumentId },
          data: { arcaResponseMetadata: { status: "RECONCILED_NOT_FOUND", checkedAt: new Date().toISOString() } },
        });
      }

      const issued = await tx.fiscalDocument.update({
        where: { id: fiscalDocumentId },
        data: {
          status: "ISSUED",
          documentNumber: String(metadata.attemptedVoucherNumber),
          issueDate: context.saleDate,
          netAmount: context.fiscalCalculation.netAmount,
          taxAmount: context.fiscalCalculation.taxAmount,
          exemptAmount: context.fiscalCalculation.exemptAmount,
          totalAmount: context.fiscalCalculation.grossAmount,
          cae: detail.cae,
          caeExpiresAt: detail.caeExpiresAt,
          arcaEnvironment: "HOMOLOGATION",
          arcaTaxBreakdown: serializeTaxBreakdown(context.fiscalCalculation),
          arcaResponseMetadata: { status: "RECONCILED_APPROVED", checkedAt: new Date().toISOString() },
        },
      });
      await recordAuditLog(
        {
          userId: actorId,
          action: "fiscal_document.arca_reconciled_issued",
          entityType: "FiscalDocument",
          entityId: fiscalDocumentId,
          newValue: { cae: issued.cae, documentNumber: issued.documentNumber },
        },
        tx,
      );
      return issued;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
