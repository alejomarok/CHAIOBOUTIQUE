import { Prisma } from "@/generated/prisma/client";
import type {
  Customer,
  FiscalDocument,
  FiscalDocumentStatus,
  InvoiceMode,
  Sale,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { minorUnitsToDisplay } from "@/lib/money";
import { recordAuditLog } from "@/modules/audit/index-core";
import { getCustomerDisplayName } from "@/modules/customers/normalize";
import { getStoreConfiguration } from "@/modules/store-settings/service-core";

import { deriveSaleInvoicingStatus } from "./invoicing-status";
import type { SaleInvoicingStatus } from "./invoicing-status";
import { getArcaDataReadiness } from "./arca/readiness-core";

export { deriveSaleInvoicingStatus } from "./invoicing-status";
export type { SaleInvoicingStatus } from "./invoicing-status";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) so this stays
// importable from a plain Node context (Playwright's test-runner process) —
// mirrors modules/sales/sale-core.ts's exact -core/wrapper split.
//
// SCOPE — Fiscal Invoicing Foundation: the data model, rules and
// administrative workflow for invoicing a CONFIRMED Sale. Explicitly still
// NOT this phase: WSAA, WSFEV1, CAE requests, ARCA certificates, fiscal QR
// generation, automatic invoice PDF/email, credit notes, refunds, Andreani.
// See modules/fiscal-documents/arca/issue-electronic-invoice-core.ts for
// the documented future ARCA boundary.

export class SaleNotFoundError extends Error {
  constructor() {
    super("Venta no encontrada.");
    this.name = "SaleNotFoundError";
  }
}

export class SaleNotInvoiceableError extends Error {
  constructor() {
    super("Solo se pueden facturar ventas confirmadas.");
    this.name = "SaleNotInvoiceableError";
  }
}

// The server-side half of this phase's mandatory duplicate-invoicing
// protection — never rely on hiding a button. Thrown both when a fresh
// pre-check finds an existing active document AND (as a second,
// concurrency-safe layer) when the DB's own partial unique index
// (fiscal_document_sale_active_unique) rejects a genuinely-racing insert.
export class SaleAlreadyHasActiveFiscalDocumentError extends Error {
  constructor() {
    super(
      "Esta venta ya tiene un comprobante fiscal activo. Anulalo antes de registrar uno nuevo.",
    );
    this.name = "SaleAlreadyHasActiveFiscalDocumentError";
  }
}

// Mandatory amount verification — see this phase's explicit "if entered
// total differs from Sale total: do not silently accept it" requirement.
// A real, immediate validation error (never a stateful "review" flag): the
// admin can simply correct the form and resubmit, unlike a provider-
// approved-but-mismatched online payment, which can't be un-approved.
export class FiscalDocumentAmountMismatchError extends Error {
  constructor(
    public readonly saleTotalAmount: bigint,
    public readonly enteredAmount: bigint,
  ) {
    super(
      `El importe ingresado (${minorUnitsToDisplay(enteredAmount)}) no coincide con el total de la venta (${minorUnitsToDisplay(saleTotalAmount)}).`,
    );
    this.name = "FiscalDocumentAmountMismatchError";
  }
}

export class DuplicateFiscalDocumentSubmissionError extends Error {
  constructor() {
    super("Este comprobante ya fue registrado.");
    this.name = "DuplicateFiscalDocumentSubmissionError";
  }
}

export class DuplicateFiscalDocumentIdentifierError extends Error {
  constructor() {
    super("Ya existe un comprobante registrado con ese tipo, punto de venta y número.");
    this.name = "DuplicateFiscalDocumentIdentifierError";
  }
}

export class FiscalDocumentNotFoundError extends Error {
  constructor() {
    super("Comprobante fiscal no encontrado.");
    this.name = "FiscalDocumentNotFoundError";
  }
}

export class FiscalDocumentAlreadyVoidedError extends Error {
  constructor() {
    super("Este comprobante ya está anulado.");
    this.name = "FiscalDocumentAlreadyVoidedError";
  }
}

export class VoidReasonRequiredError extends Error {
  constructor() {
    super("El motivo de anulación es obligatorio.");
    this.name = "VoidReasonRequiredError";
  }
}

export class RequiredFieldMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequiredFieldMissingError";
  }
}

// =============================================================================
// Shared internals
// =============================================================================

// Mirrors modules/sales/payment-core.ts's own isPaymentIdempotencyConflict,
// with one deliberate addition: for a violated EXPRESSION-based partial
// unique index (fiscal_document_identifier_unique uses COALESCE(...)
// expressions, not plain columns), Prisma 7's @prisma/adapter-pg mangles
// `error.message` into a truncated field list that never actually contains
// the real index name — the genuine constraint name only shows up nested
// inside `error.meta.driverAdapterError.cause.constraint.originalMessage`.
// A plain `String(plainObject)` collapses to "[object Object]" and loses
// that nested string entirely (verified empirically: payment-core.ts's own
// idempotencyKey check never needed this because THAT violation is a
// plain-column index, which Prisma formats into `error.message` directly)
// — JSON.stringify is what actually makes the nested originalMessage
// searchable.
function describeUnknown(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Error) {
    const causeText = "cause" in value ? describeUnknown(value.cause) : "";
    return `${value.toString()} ${causeText}`;
  }
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const IDEMPOTENCY_KEY_CONSTRAINT_NAME = "fiscal_document_idempotencykey_key";
const ACTIVE_DOCUMENT_CONSTRAINT_NAME = "fiscal_document_sale_active_unique";
const IDENTIFIER_CONSTRAINT_NAME = "fiscal_document_identifier_unique";

function isConstraintConflict(error: unknown, constraintName: string, columnHint?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;

  if (columnHint) {
    const target = error.meta?.target;
    if (Array.isArray(target) && target.includes(columnHint)) return true;
    if (typeof target === "string" && target.includes(columnHint)) return true;
  }

  const haystack = [describeUnknown(error.message), describeUnknown(error.meta?.driverAdapterError)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(constraintName.toLowerCase());
}

type SaleWithCustomer = Sale & { customer: Customer };

// The one place every registration/intent function verifies a Sale is
// eligible to be invoiced — status must be CONFIRMED (never DRAFT, never
// CANCELLED — see this phase's explicit Scenario F), and no ACTIVE
// (non-VOIDED) fiscal document may already exist (the pre-check half of
// duplicate protection; the DB's own partial unique index is the
// concurrency-safe second half — see insertFiscalDocument below).
async function assertSaleInvoiceable(tx: Prisma.TransactionClient, saleId: string): Promise<SaleWithCustomer> {
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { customer: true } });
  if (!sale) throw new SaleNotFoundError();
  if (sale.status !== "CONFIRMED") throw new SaleNotInvoiceableError();

  const activeDocumentCount = await tx.fiscalDocument.count({
    where: { saleId, status: { not: "VOIDED" } },
  });
  if (activeDocumentCount > 0) throw new SaleAlreadyHasActiveFiscalDocumentError();

  return sale;
}

function assertAmountMatchesSale(sale: Sale, enteredAmount: bigint): void {
  if (enteredAmount !== sale.totalAmount) {
    throw new FiscalDocumentAmountMismatchError(sale.totalAmount, enteredAmount);
  }
}

interface InsertFiscalDocumentInput {
  mode: InvoiceMode;
  status: FiscalDocumentStatus;
  documentType?: string | null;
  pointOfSale?: string | null;
  documentNumber?: string | null;
  issueDate?: Date | null;
  totalAmount: bigint;
  sourceSystem?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

// The one insert path every mode goes through — snapshots the customer's
// current fiscal fields (see the FiscalDocument model's own "historical
// fiscal documents must not change when Customer changes later" comment),
// resolves currency from StoreConfiguration (same per-row-currency posture
// as Order/Cart), and sets netAmount = totalAmount / taxAmount = 0 — NOT a
// real VAT breakdown; see this model's own schema comment for why (Sale.
// taxTotalAmount is always 0 today, and this phase deliberately never fakes
// a tax calculation to populate a field).
async function insertFiscalDocument(
  tx: Prisma.TransactionClient,
  sale: SaleWithCustomer,
  input: InsertFiscalDocumentInput,
  actorId: string,
): Promise<FiscalDocument> {
  const storeConfig = await getStoreConfiguration();

  let document: FiscalDocument;
  try {
    document = await tx.fiscalDocument.create({
      data: {
        saleId: sale.id,
        mode: input.mode,
        status: input.status,
        documentType: input.documentType ?? null,
        pointOfSale: input.pointOfSale ?? null,
        documentNumber: input.documentNumber ?? null,
        issueDate: input.issueDate ?? null,
        currency: storeConfig.currency,
        netAmount: input.totalAmount,
        taxAmount: 0n,
        totalAmount: input.totalAmount,
        customerNameSnapshot: getCustomerDisplayName(sale.customer),
        customerDocumentTypeSnapshot: sale.customer.documentType,
        customerDocumentNumberSnapshot: sale.customer.documentNumber,
        customerTaxIdSnapshot: sale.customer.taxId,
        customerTaxConditionSnapshot: sale.customer.taxCondition,
        sourceSystem: input.sourceSystem ?? null,
        externalReference: input.externalReference ?? null,
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey,
        createdById: actorId,
      },
    });
  } catch (error) {
    if (isConstraintConflict(error, IDEMPOTENCY_KEY_CONSTRAINT_NAME, "idempotencyKey")) {
      throw new DuplicateFiscalDocumentSubmissionError();
    }
    if (isConstraintConflict(error, ACTIVE_DOCUMENT_CONSTRAINT_NAME)) {
      throw new SaleAlreadyHasActiveFiscalDocumentError();
    }
    if (isConstraintConflict(error, IDENTIFIER_CONSTRAINT_NAME)) {
      throw new DuplicateFiscalDocumentIdentifierError();
    }
    throw error;
  }

  await recordAuditLog(
    {
      userId: actorId,
      action: `fiscal_document.registered_${input.mode.toLowerCase()}`,
      entityType: "FiscalDocument",
      entityId: document.id,
      newValue: {
        saleId: sale.id,
        mode: document.mode,
        status: document.status,
        documentType: document.documentType,
        pointOfSale: document.pointOfSale,
        documentNumber: document.documentNumber,
        totalAmount: document.totalAmount.toString(),
      },
    },
    tx,
  );

  return document;
}

// =============================================================================
// MANUAL — a real administrative workflow: an authorized user (invoices.
// issue) registers that a Sale was already invoiced by hand. ISSUED
// immediately (it documents an already-completed fact).
// =============================================================================

export interface RegisterManualFiscalDocumentInput {
  saleId: string;
  documentType: string;
  pointOfSale: string;
  documentNumber: string;
  issueDate: Date;
  totalAmount: bigint;
  notes?: string | null;
  // Client-generated (crypto.randomUUID() at form-mount time, resubmitted
  // unchanged on retry) — see this phase's explicit "repeated form
  // submissions must not create duplicate fiscal documents" requirement.
  idempotencyKey: string;
}

export async function registerManualFiscalDocument(
  input: RegisterManualFiscalDocumentInput,
  actorId: string,
): Promise<FiscalDocument> {
  const existing = await prisma.fiscalDocument.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  if (!input.documentType.trim()) throw new RequiredFieldMissingError("Ingresá el tipo de comprobante.");
  if (!input.pointOfSale.trim()) throw new RequiredFieldMissingError("Ingresá el punto de venta.");
  if (!input.documentNumber.trim()) throw new RequiredFieldMissingError("Ingresá el número de comprobante.");

  return prisma.$transaction(async (tx) => {
    const sale = await assertSaleInvoiceable(tx, input.saleId);
    assertAmountMatchesSale(sale, input.totalAmount);

    return insertFiscalDocument(
      tx,
      sale,
      {
        mode: "MANUAL",
        status: "ISSUED",
        documentType: input.documentType.trim(),
        pointOfSale: input.pointOfSale.trim(),
        documentNumber: input.documentNumber.trim(),
        issueDate: input.issueDate,
        totalAmount: input.totalAmount,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      },
      actorId,
    );
  });
}

// =============================================================================
// SISTEMA_EXTERNO — mandatory for the migration from CHAIOBOUTIQUE's
// previous/parallel system. A Sale registered this way is NOT "unbilled" —
// see this phase's explicit "prevent duplicate invoicing during migration"
// requirement. ISSUED immediately, same posture as MANUAL.
// =============================================================================

export interface RegisterExternalFiscalDocumentInput {
  saleId: string;
  documentType: string;
  pointOfSale?: string | null;
  documentNumber: string;
  issueDate: Date;
  totalAmount: bigint;
  sourceSystem: string;
  externalReference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

export async function registerExternalFiscalDocument(
  input: RegisterExternalFiscalDocumentInput,
  actorId: string,
): Promise<FiscalDocument> {
  const existing = await prisma.fiscalDocument.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  if (!input.documentType.trim()) throw new RequiredFieldMissingError("Ingresá el tipo de comprobante.");
  if (!input.documentNumber.trim()) throw new RequiredFieldMissingError("Ingresá el número de comprobante.");
  if (!input.sourceSystem.trim()) throw new RequiredFieldMissingError("Ingresá el sistema de origen.");

  return prisma.$transaction(async (tx) => {
    const sale = await assertSaleInvoiceable(tx, input.saleId);
    assertAmountMatchesSale(sale, input.totalAmount);

    return insertFiscalDocument(
      tx,
      sale,
      {
        mode: "SISTEMA_EXTERNO",
        status: "ISSUED",
        documentType: input.documentType.trim(),
        pointOfSale: input.pointOfSale?.trim() || null,
        documentNumber: input.documentNumber.trim(),
        issueDate: input.issueDate,
        totalAmount: input.totalAmount,
        sourceSystem: input.sourceSystem.trim(),
        externalReference: input.externalReference?.trim() || null,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      },
      actorId,
    );
  });
}

// =============================================================================
// ELECTRONICA_ARCA — PREPARATION only, this phase. Creates a PENDING
// intent; NEVER contacts ARCA, NEVER fabricates a CAE/invoice number/
// response/QR. See modules/fiscal-documents/arca/
// issue-electronic-invoice-core.ts for the documented future seam that
// would actually advance a PENDING intent to ISSUED.
// =============================================================================

// Phase — ARCA Fiscal Readiness + Tax Model. Thrown when the store's own
// fiscal identity (StoreConfiguration) is incomplete — "DATA READY", never
// "CONNECTION READY" (there is no certificate/network configuration to
// check yet; see arca/readiness-core.ts's own header comment for why this
// intent-creation gate deliberately never checks connection readiness).
// This is a real, useful gate even though issuing electronically is still
// unimplemented: it stops an admin from registering an ARCA intent for a
// store that could never actually resolve a document type once ARCA
// integration exists, rather than deferring that discovery indefinitely.
export class ArcaDataNotReadyError extends Error {
  constructor(blockerMessages: string[]) {
    super(`No se puede registrar la intención de facturación ARCA: ${blockerMessages.join(" ")}`);
    this.name = "ArcaDataNotReadyError";
  }
}

export interface CreateArcaInvoicingIntentInput {
  saleId: string;
  notes?: string | null;
  idempotencyKey: string;
}

export async function createArcaInvoicingIntent(
  input: CreateArcaInvoicingIntentInput,
  actorId: string,
): Promise<FiscalDocument> {
  const existing = await prisma.fiscalDocument.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  const dataReadiness = await getArcaDataReadiness();
  if (!dataReadiness.ready) {
    throw new ArcaDataNotReadyError(dataReadiness.blockers.map((blocker) => blocker.message));
  }

  return prisma.$transaction(async (tx) => {
    const sale = await assertSaleInvoiceable(tx, input.saleId);

    return insertFiscalDocument(
      tx,
      sale,
      {
        mode: "ELECTRONICA_ARCA",
        status: "PENDING",
        totalAmount: sale.totalAmount,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      },
      actorId,
    );
  });
}

// =============================================================================
// Correction — see this phase's explicit "prefer finalized records
// immutable... mark previous record VOIDED with mandatory reason" policy.
// Never a real ARCA electronic-invoice cancellation or a credit/debit note
// (neither exists yet) — purely "this CHAIOBOUTIQUE record was a
// data-entry mistake". Requires invoices.cancel (a separate, stricter
// permission than invoices.issue — see the role matrix in the final
// report).
// =============================================================================

export async function voidFiscalDocument(
  id: string,
  reason: string,
  actorId: string,
): Promise<FiscalDocument> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new VoidReasonRequiredError();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.fiscalDocument.findUnique({ where: { id } });
    if (!existing) throw new FiscalDocumentNotFoundError();
    if (existing.status === "VOIDED") throw new FiscalDocumentAlreadyVoidedError();

    const voided = await tx.fiscalDocument.update({
      where: { id },
      data: { status: "VOIDED", voidedAt: new Date(), voidedById: actorId, voidReason: trimmedReason },
    });

    await recordAuditLog(
      {
        userId: actorId,
        action: "fiscal_document.voided",
        entityType: "FiscalDocument",
        entityId: id,
        previousValue: { status: existing.status },
        newValue: { status: "VOIDED", reason: trimmedReason },
        metadata: { saleId: existing.saleId },
      },
      tx,
    );

    return voided;
  });
}

// =============================================================================
// Read paths
// =============================================================================

export interface SaleInvoicingSummary {
  status: SaleInvoicingStatus;
  activeDocument: FiscalDocument | null;
}

export async function getSaleInvoicingSummary(saleId: string): Promise<SaleInvoicingSummary> {
  const activeDocument = await prisma.fiscalDocument.findFirst({
    where: { saleId, status: { not: "VOIDED" } },
    orderBy: { createdAt: "desc" },
  });
  return { status: deriveSaleInvoicingStatus(activeDocument), activeDocument };
}

// Batch equivalent of getSaleInvoicingSummary, for a list page — one query
// regardless of row count, never N+1 (mirrors modules/inventory/
// service-core.ts's getAvailableToSellForVariants exact posture). Safe to
// group by saleId in a plain Map: the partial unique index
// (fiscal_document_sale_active_unique) already guarantees at most one
// non-VOIDED row per Sale, so there is never more than one match to fold
// per key.
export async function getInvoicingStatusForSales(
  saleIds: string[],
): Promise<Map<string, SaleInvoicingStatus>> {
  if (saleIds.length === 0) return new Map();
  const activeDocuments = await prisma.fiscalDocument.findMany({
    where: { saleId: { in: saleIds }, status: { not: "VOIDED" } },
    select: { saleId: true, status: true },
  });
  return new Map(activeDocuments.map((doc) => [doc.saleId, deriveSaleInvoicingStatus(doc)]));
}

// Full history for a Sale, newest first — includes VOIDED rows (never
// hidden; this schema never hard-deletes fiscal history). Used by the
// admin Sale detail page's "Facturación" section.
export async function listFiscalDocumentsForSale(saleId: string) {
  return prisma.fiscalDocument.findMany({
    where: { saleId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true } },
    },
  });
}

export async function getFiscalDocumentById(id: string) {
  return prisma.fiscalDocument.findUnique({
    where: { id },
    include: {
      sale: { select: { id: true, code: true } },
      createdBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true } },
    },
  });
}
