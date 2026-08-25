"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { displayToMinorUnits, InvalidMoneyInputError, minorUnitsToDisplay, serializeMoney } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import { issueElectronicInvoice, reconcileArcaFiscalDocument } from "@/modules/fiscal-documents/arca";
import type { FiscalDocument } from "@/generated/prisma/client";
import {
  createArcaInvoicingIntent,
  FiscalDocumentAmountMismatchError,
  registerExternalFiscalDocument,
  registerManualFiscalDocument,
  voidFiscalDocument,
} from "@/modules/fiscal-documents/fiscal-document";
import { MANUAL_PAYMENT_METHODS, registerSalePayment, voidSalePayment } from "@/modules/sales/payment";
import {
  cancelSale,
  confirmSale,
  createSale,
  getAvailableStockForVariants,
  InsufficientSaleStockError,
  searchSellableVariants,
  updateSale,
} from "@/modules/sales/sale";

// Same moneyField pattern as app/(admin)/admin/products/actions.ts — a
// display-formatted string ("1500,50") parsed into exact BigInt minor
// units, never a float intermediate. See lib/money.ts.
const moneyField = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    try {
      return displayToMinorUnits(value);
    } catch (error) {
      if (error instanceof InvalidMoneyInputError) {
        ctx.addIssue({ code: "custom", message: "Monto inválido" });
        return z.NEVER;
      }
      throw error;
    }
  });

// Same parsing as moneyField, but mandatory — a payment's amount can never
// be blank/skipped the way a sale item's unit-price override can.
const requiredMoneyField = z
  .string()
  .min(1, "Ingresá un importe.")
  .transform((value, ctx) => {
    try {
      return displayToMinorUnits(value);
    } catch (error) {
      if (error instanceof InvalidMoneyInputError) {
        ctx.addIssue({ code: "custom", message: "Monto inválido" });
        return z.NEVER;
      }
      throw error;
    }
  });

const saleItemSchema = z.object({
  productVariantId: z.string().min(1),
  quantity: z.number().int().positive("La cantidad debe ser mayor a 0."),
  unitPriceAmount: moneyField,
  discountAmount: moneyField,
});

const saleFieldsSchema = z.object({
  customerId: z.string().min(1, "Seleccioná un cliente."),
  // Omitted: resolves server-side to the system default warehouse.
  warehouseId: z.string().optional(),
  items: z.array(saleItemSchema),
  notes: z.string().optional(),
  confirm: z.boolean().optional(),
});

// Friendly Spanish translation for the service layer's typed errors — never
// a raw internal error string reaches the client.
// InsufficientSaleStockError's own .message is ALREADY the final, detailed,
// itemized Spanish text (see modules/sales/sale-core.ts) — passed through
// verbatim, never re-wrapped.
function toFriendlyMessage(error: unknown): string {
  if (error instanceof InsufficientSaleStockError) return error.message;
  if (error instanceof Error) {
    const knownErrors = [
      "SaleNotFoundError",
      "SaleNotEditableError",
      "SaleAlreadyCancelledError",
      "EmptySaleCannotBeConfirmedError",
      "ProductVariantNotFoundError",
      "ProductVariantMissingPriceError",
      "InvalidSaleItemError",
      "WarehouseNotFoundError",
      "NoDefaultWarehouseError",
      "InactiveWarehouseError",
      "CancellationReasonRequiredError",
      "SaleHasActivePaymentsError",
      "SaleHasFiscalDocumentError",
      "SalePaymentNotFoundError",
      "SaleNotConfirmedError",
      "SaleCancelledCannotAcceptPaymentsError",
      "InvalidPaymentAmountError",
      "PaymentExceedsRemainingBalanceError",
      "DuplicatePaymentSubmissionError",
      "PaymentAlreadyVoidedError",
      "VoidReasonRequiredError",
    ];
    if (knownErrors.includes(error.name)) return error.message;
  }
  return "No pudimos guardar la venta. Intentá de nuevo.";
}

export async function createSaleAction(input: z.input<typeof saleFieldsSchema>) {
  const actor = await requirePermission("sales.create");
  const data = saleFieldsSchema.parse(input);
  // Never trust the client's own hiding of the discount field — re-checked
  // here exactly like products/actions.ts's canSetCost.
  const canApplyDiscount = actor.permissions.has("sales.apply_discount");

  try {
    const sale = await createSale(
      {
        customerId: data.customerId,
        warehouseId: data.warehouseId,
        items: data.items.map((item) => ({
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          unitPriceAmount: item.unitPriceAmount,
          discountAmount: canApplyDiscount ? item.discountAmount : null,
        })),
        notes: data.notes || null,
        confirm: data.confirm,
      },
      actor.id,
    );
    revalidatePath("/admin/sales");
    if (data.confirm) {
      // A confirmed sale changed real stock — every screen that shows it
      // must reflect the new quantity without a manual refresh.
      revalidatePath("/admin/inventory");
      revalidatePath("/admin/products");
    }
    return { id: sale.id };
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
}

export async function updateSaleAction(id: string, input: z.input<typeof saleFieldsSchema>) {
  const actor = await requirePermission("sales.create");
  const data = saleFieldsSchema.parse(input);
  const canApplyDiscount = actor.permissions.has("sales.apply_discount");

  try {
    await updateSale(
      id,
      {
        warehouseId: data.warehouseId,
        items: data.items.map((item) => ({
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          unitPriceAmount: item.unitPriceAmount,
          discountAmount: canApplyDiscount ? item.discountAmount : null,
        })),
        notes: data.notes || null,
        confirm: data.confirm,
      },
      actor.id,
    );
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${id}`);
  if (data.confirm) {
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/products");
  }
}

export async function confirmSaleAction(id: string) {
  const actor = await requirePermission("sales.create");
  try {
    await confirmSale(id, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${id}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
}

// reason is mandatory — see modules/sales/sale-core.ts's cancelSale.
const cancelSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1, "El motivo de cancelación es obligatorio."),
});

export async function cancelSaleAction(input: z.infer<typeof cancelSchema>) {
  const actor = await requirePermission("sales.cancel");
  const data = cancelSchema.parse(input);
  try {
    await cancelSale(data.id, data.reason, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${data.id}`);
  // A cancelled CONFIRMED sale restores stock — same revalidation need as
  // confirming one.
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
}

const searchSchema = z.object({ query: z.string(), warehouseId: z.string().min(1) });

export interface SellableVariantDTO {
  id: string;
  sku: string;
  displayName: string;
  // Serialized (see lib/money.ts) — a raw bigint can't cross this boundary.
  effectivePriceAmount: string | null;
  availableStock: number;
}

export async function searchSellableVariantsAction(
  input: z.infer<typeof searchSchema>,
): Promise<SellableVariantDTO[]> {
  await requirePermission("sales.create");
  const data = searchSchema.parse(input);
  const variants = await searchSellableVariants(data.query, data.warehouseId);
  return variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    displayName: variant.displayName,
    effectivePriceAmount:
      variant.effectivePriceAmount !== null ? serializeMoney(variant.effectivePriceAmount) : null,
    availableStock: variant.availableStock,
  }));
}

const stockQuerySchema = z.object({
  variantIds: z.array(z.string()),
  warehouseId: z.string().min(1),
});

// Lets the form re-check available stock for lines already added (from a
// search result or from an edited draft's saved items) whenever the
// selected warehouse changes — never trusted at confirmation time either
// way (see sale-core.ts's findStockShortfalls / applyInventoryOperation),
// this is display-only.
export async function getAvailableStockForVariantsAction(
  input: z.infer<typeof stockQuerySchema>,
): Promise<Record<string, number>> {
  await requirePermission("sales.create");
  const data = stockQuerySchema.parse(input);
  const stock = await getAvailableStockForVariants(data.variantIds, data.warehouseId);
  return Object.fromEntries(stock);
}

// =============================================================================
// Sales Payments foundation
// =============================================================================

const registerPaymentSchema = z.object({
  saleId: z.string().min(1),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amount: requiredMoneyField,
  reference: z.string().optional(),
  // "YYYY-MM-DD" from an <input type="date">, interpreted in local time —
  // blank means "now" (the common case: registering a payment as it
  // happens), never required to backdate.
  paidAt: z.string().optional(),
  notes: z.string().optional(),
  // Client-generated at form-mount time (crypto.randomUUID()) and
  // resubmitted unchanged on retry — see modules/sales/payment-core.ts's
  // registerSalePayment for how this protects against a double-click or
  // network retry double-charging the sale.
  idempotencyKey: z.string().min(1),
});

export async function registerSalePaymentAction(input: z.input<typeof registerPaymentSchema>) {
  const actor = await requirePermission("sales.record_payment");
  const data = registerPaymentSchema.parse(input);

  try {
    await registerSalePayment(
      {
        saleId: data.saleId,
        method: data.method,
        amount: data.amount,
        reference: data.reference || null,
        notes: data.notes || null,
        paidAt: data.paidAt ? new Date(`${data.paidAt}T00:00:00`) : undefined,
        idempotencyKey: data.idempotencyKey,
      },
      actor.id,
    );
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${data.saleId}`);
}

const voidPaymentSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().min(1, "El motivo de anulación es obligatorio."),
});

export async function voidSalePaymentAction(input: z.infer<typeof voidPaymentSchema>) {
  const actor = await requirePermission("sales.void_payment");
  const data = voidPaymentSchema.parse(input);

  const payment = await (async () => {
    try {
      return await voidSalePayment(data.paymentId, data.reason, actor.id);
    } catch (error) {
      throw new Error(toFriendlyMessage(error));
    }
  })();

  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${payment.saleId}`);
}

// =============================================================================
// Fiscal Invoicing Foundation
// =============================================================================

// FiscalDocumentAmountMismatchError's own .message is ALREADY the final,
// specific Spanish text (see modules/fiscal-documents/fiscal-document-core.ts)
// — passed through verbatim, same posture as InsufficientSaleStockError
// above.
function toFiscalFriendlyMessage(error: unknown): string {
  if (error instanceof FiscalDocumentAmountMismatchError) return error.message;
  if (error instanceof Error) {
    const knownErrors = [
      "SaleNotFoundError",
      "SaleNotInvoiceableError",
      "SaleAlreadyHasActiveFiscalDocumentError",
      "DuplicateFiscalDocumentSubmissionError",
      "DuplicateFiscalDocumentIdentifierError",
      "FiscalDocumentNotFoundError",
      "FiscalDocumentAlreadyVoidedError",
      "VoidReasonRequiredError",
      "RequiredFieldMissingError",
    ];
    if (knownErrors.includes(error.name)) return error.message;
  }
  return "No pudimos registrar la facturación. Intentá de nuevo.";
}

const registerManualInvoiceSchema = z.object({
  saleId: z.string().min(1),
  documentType: z.string().min(1, "Ingresá el tipo de comprobante."),
  pointOfSale: z.string().min(1, "Ingresá el punto de venta."),
  documentNumber: z.string().min(1, "Ingresá el número de comprobante."),
  // "YYYY-MM-DD" from an <input type="date">, interpreted in local time —
  // same convention as registerPaymentSchema's own paidAt above.
  issueDate: z.string().min(1, "Ingresá la fecha."),
  totalAmount: requiredMoneyField,
  notes: z.string().optional(),
  // Client-generated at dialog-open time, resubmitted unchanged on retry —
  // see modules/fiscal-documents/fiscal-document-core.ts's own "repeated
  // form submissions must not create duplicate fiscal documents"
  // requirement.
  idempotencyKey: z.string().min(1),
});

export async function registerManualInvoiceAction(
  input: z.input<typeof registerManualInvoiceSchema>,
) {
  const actor = await requirePermission("invoices.issue");
  const data = registerManualInvoiceSchema.parse(input);

  try {
    await registerManualFiscalDocument(
      {
        saleId: data.saleId,
        documentType: data.documentType,
        pointOfSale: data.pointOfSale,
        documentNumber: data.documentNumber,
        issueDate: new Date(`${data.issueDate}T00:00:00`),
        totalAmount: data.totalAmount,
        notes: data.notes || null,
        idempotencyKey: data.idempotencyKey,
      },
      actor.id,
    );
  } catch (error) {
    throw new Error(toFiscalFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${data.saleId}`);
}

const registerExternalInvoiceSchema = z.object({
  saleId: z.string().min(1),
  documentType: z.string().min(1, "Ingresá el tipo de comprobante."),
  pointOfSale: z.string().optional(),
  documentNumber: z.string().min(1, "Ingresá el número de comprobante."),
  issueDate: z.string().min(1, "Ingresá la fecha."),
  totalAmount: requiredMoneyField,
  sourceSystem: z.string().min(1, "Ingresá el sistema de origen."),
  externalReference: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

export async function registerExternalInvoiceAction(
  input: z.input<typeof registerExternalInvoiceSchema>,
) {
  const actor = await requirePermission("invoices.issue");
  const data = registerExternalInvoiceSchema.parse(input);

  try {
    await registerExternalFiscalDocument(
      {
        saleId: data.saleId,
        documentType: data.documentType,
        pointOfSale: data.pointOfSale || null,
        documentNumber: data.documentNumber,
        issueDate: new Date(`${data.issueDate}T00:00:00`),
        totalAmount: data.totalAmount,
        sourceSystem: data.sourceSystem,
        externalReference: data.externalReference || null,
        notes: data.notes || null,
        idempotencyKey: data.idempotencyKey,
      },
      actor.id,
    );
  } catch (error) {
    throw new Error(toFiscalFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${data.saleId}`);
}

const createArcaIntentSchema = z.object({
  saleId: z.string().min(1),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

// Creates only a PENDING intent — never contacts ARCA. See
// modules/fiscal-documents/fiscal-document-core.ts's createArcaInvoicingIntent
// and modules/fiscal-documents/arca/issue-electronic-invoice-core.ts's
// documented future boundary.
export async function createArcaInvoicingIntentAction(
  input: z.input<typeof createArcaIntentSchema>,
) {
  const actor = await requirePermission("invoices.issue");
  const data = createArcaIntentSchema.parse(input);

  try {
    await createArcaInvoicingIntent(
      { saleId: data.saleId, notes: data.notes || null, idempotencyKey: data.idempotencyKey },
      actor.id,
    );
  } catch (error) {
    throw new Error(toFiscalFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${data.saleId}`);
}

const voidFiscalDocumentSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1, "El motivo de anulación es obligatorio."),
});

// Administrative correction only — never a real ARCA electronic-invoice
// cancellation or a credit/debit note (neither exists yet). Requires
// invoices.cancel, a stricter/separate permission from invoices.issue —
// see this phase's role matrix in the final report.
export async function voidFiscalDocumentAction(input: z.infer<typeof voidFiscalDocumentSchema>) {
  const actor = await requirePermission("invoices.cancel");
  const data = voidFiscalDocumentSchema.parse(input);

  const document = await (async () => {
    try {
      return await voidFiscalDocument(data.id, data.reason, actor.id);
    } catch (error) {
      throw new Error(toFiscalFriendlyMessage(error));
    }
  })();

  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${document.saleId}`);
}

// =============================================================================
// Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration.
// =============================================================================

function toArcaIssuanceFriendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    const knownErrors = [
      "ArcaIssuanceNotReadyError",
      "ArcaIssuanceUncertainError",
      "NoPendingArcaIntentError",
      "FiscalDocumentNotReconcilableError",
      "FiscalDocumentNotFoundError",
      "ArcaEnvironmentNotHomologationError",
      "ArcaCertificateNotConfiguredError",
      "ArcaCertificateUnreadableError",
      "ArcaCertificateInvalidError",
      "WsaaFaultError",
      "WsfeFaultError",
      "WsfeNetworkError",
      "SaleNotFoundError",
    ];
    if (knownErrors.includes(error.name)) return error.message;
  }
  return "No pudimos emitir el comprobante electrónico. Intentá de nuevo.";
}

// Never crosses the Server Action boundary with a raw bigint — see
// lib/money.ts's own documented rule. This is the "post-success result
// display" the confirmation dialog shows (Entorno/Tipo/Punto de venta/
// Número/CAE/Vencimiento CAE/Fecha).
export interface ArcaIssuanceResultDTO {
  status: "PENDING" | "ISSUED" | "ERROR" | "VOIDED";
  arcaEnvironment: "HOMOLOGATION" | "PRODUCTION" | null;
  documentType: string | null;
  pointOfSale: string | null;
  documentNumber: string | null;
  cae: string | null;
  caeExpiresAt: string | null;
  issueDate: string | null;
  totalAmountDisplay: string | null;
}

function toArcaIssuanceResultDTO(document: FiscalDocument): ArcaIssuanceResultDTO {
  return {
    status: document.status,
    arcaEnvironment: document.arcaEnvironment,
    documentType: document.documentType,
    pointOfSale: document.pointOfSale,
    documentNumber: document.documentNumber,
    cae: document.cae,
    caeExpiresAt: document.caeExpiresAt ? document.caeExpiresAt.toISOString() : null,
    issueDate: document.issueDate ? document.issueDate.toISOString() : null,
    totalAmountDisplay:
      document.status === "ISSUED" ? minorUnitsToDisplay(document.totalAmount, { currency: document.currency }) : null,
  };
}

// Real WSAA + WSFEv1 issuance — see modules/fiscal-documents/arca/
// issue-electronic-invoice-core.ts for the full flow. Requires
// invoices.issue (the same permission that already gates registering any
// other kind of fiscal document for a Sale).
export async function issueElectronicInvoiceAction(saleId: string): Promise<ArcaIssuanceResultDTO> {
  const actor = await requirePermission("invoices.issue");

  let document: FiscalDocument;
  try {
    document = await issueElectronicInvoice(saleId, actor.id);
  } catch (error) {
    throw new Error(toArcaIssuanceFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${saleId}`);
  return toArcaIssuanceResultDTO(document);
}

// Retry-safety UI action (section 17) — "Verificar estado en ARCA", shown
// only when a prior issuance attempt was left uncertain. Never re-requests
// a CAE directly.
export async function reconcileArcaFiscalDocumentAction(
  fiscalDocumentId: string,
  saleId: string,
): Promise<ArcaIssuanceResultDTO> {
  const actor = await requirePermission("invoices.issue");

  let document: FiscalDocument;
  try {
    document = await reconcileArcaFiscalDocument(fiscalDocumentId, actor.id);
  } catch (error) {
    throw new Error(toArcaIssuanceFriendlyMessage(error));
  }
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/sales/${saleId}`);
  return toArcaIssuanceResultDTO(document);
}
