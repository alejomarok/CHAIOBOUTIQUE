import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, SalePayment } from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { minorUnitsToDisplay } from "@/lib/money";
import { recordAuditLog } from "@/modules/audit/index-core";

import { computeSalePaymentStatus } from "./totals";

export { MANUAL_PAYMENT_METHODS } from "./payment-labels";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) — mirrors
// modules/sales/sale-core.ts's exact -core/wrapper split so this stays
// importable from a plain Node context (Playwright's test-runner process).
//
// SCOPE — this phase gives a CONFIRMED Sale a robust, provider-agnostic
// payment-collection model. Explicitly still NOT this phase: ARCA invoice
// generation, invoice PDFs/email delivery, Mercado Pago's actual webhook/API
// integration, online order conversion, shipping, or a general returns/
// refunds module. See the SalePayment model's own schema comment.

export class SalePaymentNotFoundError extends Error {
  constructor() {
    super("Pago no encontrado.");
    this.name = "SalePaymentNotFoundError";
  }
}

export class SaleNotFoundError extends Error {
  constructor() {
    super("Venta no encontrada.");
    this.name = "SaleNotFoundError";
  }
}

// Draft sales never accept payments — see this phase's lifecycle policy:
// items/customer can still change, and inventory hasn't been committed yet,
// so there is nothing durable to collect against.
export class SaleNotConfirmedError extends Error {
  constructor() {
    super("La venta todavía es un borrador. Confirmala antes de registrar pagos.");
    this.name = "SaleNotConfirmedError";
  }
}

export class SaleCancelledCannotAcceptPaymentsError extends Error {
  constructor() {
    super("Esta venta está cancelada y no puede recibir pagos.");
    this.name = "SaleCancelledCannotAcceptPaymentsError";
  }
}

export class InvalidPaymentAmountError extends Error {
  constructor() {
    super("El importe del pago debe ser mayor a 0.");
    this.name = "InvalidPaymentAmountError";
  }
}

// The overpayment guard — see registerSalePayment's own doc comment for the
// concurrency mechanism. Carries the exact figures so the UI can show a
// precise, itemized message rather than a generic rejection.
export class PaymentExceedsRemainingBalanceError extends Error {
  constructor(
    public readonly remainingAmount: bigint,
    public readonly attemptedAmount: bigint,
  ) {
    super(
      `El pago supera el saldo pendiente. Saldo pendiente: ${minorUnitsToDisplay(remainingAmount)}. Intentaste registrar: ${minorUnitsToDisplay(attemptedAmount)}.`,
    );
    this.name = "PaymentExceedsRemainingBalanceError";
  }
}

// A literal duplicate submission (double-click / network retry resubmitting
// the same client-generated idempotencyKey) — never a second charge. See
// modules/inventory/idempotency.ts for the same pattern applied to
// InventoryOperation.
export class DuplicatePaymentSubmissionError extends Error {
  constructor() {
    super("Este pago ya fue registrado.");
    this.name = "DuplicatePaymentSubmissionError";
  }
}

export class PaymentAlreadyVoidedError extends Error {
  constructor() {
    super("Este pago ya está anulado.");
    this.name = "PaymentAlreadyVoidedError";
  }
}

export class VoidReasonRequiredError extends Error {
  constructor() {
    super("El motivo de anulación es obligatorio.");
    this.name = "VoidReasonRequiredError";
  }
}

// Mirrors modules/inventory/idempotency.ts's isIdempotencyKeyConflict — same
// P2002-first check, same "search every string this error carries for the
// constraint name" strategy, since Prisma 7's @prisma/adapter-pg doesn't
// always populate the classic flat `meta.target` shape. Scoped specifically
// to sale_payment's idempotencyKey constraint, never "any P2002" (a
// different unique violation surfacing through this same insert must never
// be misreported as a duplicate submission).
const IDEMPOTENCY_KEY_CONSTRAINT_NAME = "sale_payment_idempotencyKey_key";

function describeUnknown(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Error) {
    const causeText = "cause" in value ? describeUnknown(value.cause) : "";
    return `${value.toString()} ${causeText}`;
  }
  if (typeof value === "string") return value;
  return String(value);
}

function isPaymentIdempotencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = error.meta?.target;
  if (Array.isArray(target) && target.includes("idempotencyKey")) return true;
  if (typeof target === "string" && target.includes("idempotencyKey")) return true;

  const haystack = [describeUnknown(error.message), describeUnknown(error.meta?.driverAdapterError)]
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("idempotencykey") ||
    haystack.includes(IDEMPOTENCY_KEY_CONSTRAINT_NAME.toLowerCase())
  );
}

interface SaleLockRow {
  id: string;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  totalAmount: bigint;
  refundedAmount: bigint;
  chargebackAmount: bigint;
}

export interface RegisterSalePaymentInput {
  saleId: string;
  method: PaymentMethod;
  amount: bigint;
  reference?: string | null;
  notes?: string | null;
  paidAt?: Date;
  // Client-generated (crypto.randomUUID() at form-mount time, resubmitted
  // unchanged on retry) — see this function's own doc comment.
  idempotencyKey: string;
}

// The transaction-aware core — Phase: Mercado Pago Checkout Pro
// integration. Extracted so modules/orders/order-core.ts's finalizePaidOrder
// can register the online payment through this EXACT SAME logic (overpayment
// guard, aggregate recompute, audit log) inside its own already-open
// transaction, never a second, parallel payment-registration code path —
// see this integration's explicit "do not implement a parallel payment-
// status system" requirement. registerSalePayment below is now a thin
// wrapper opening its own transaction, byte-identical behavior to before
// this split.
//
// Concurrency: this function's FIRST statement takes a `SELECT ... FOR
// UPDATE` row lock on the parent Sale — every payment mutation (this
// function and voidSalePayment below) takes that exact same lock before
// touching any SalePayment row for the sale, which fully serializes every
// concurrent attempt to register or void a payment against one sale through
// Postgres's native row lock. A second concurrent call for the same sale
// simply blocks until the first transaction commits or rolls back, then
// proceeds against the now-current, fully-committed state — never a
// read-then-write race, never a partial/lost update. This is the same
// "serialize every mutation of a shared aggregate through one lock" idiom
// applyInventoryOperation uses (there, via a single guarded UPDATE's WHERE
// clause on a per-row balance; here, via an explicit row lock, because the
// aggregate being maintained is a re-summed total across many SalePayment
// rows rather than one incremental delta against one row).
//
// Two independent safety nets, matching applyInventoryOperation's own
// two-layer protection:
//   1. idempotencyKey's unique constraint — the SAME logical request
//      (double-click, network retry) can only ever create one payment row.
//   2. The lock + re-aggregate-then-guard below — TWO DIFFERENT legitimate
//      payment requests racing for the same remaining balance can only
//      ever succeed once between them; the loser's transaction is rolled
//      back in full (the payment row it inserted never persists) and it
//      receives PaymentExceedsRemainingBalanceError.
export async function registerSalePaymentWithinTransaction(
  tx: Prisma.TransactionClient,
  input: RegisterSalePaymentInput,
  actorId: string,
): Promise<SalePayment> {
  if (input.amount <= 0n) throw new InvalidPaymentAmountError();

  const [locked] = await tx.$queryRaw<SaleLockRow[]>`
    SELECT id, status, "totalAmount", "refundedAmount", "chargebackAmount" FROM sale WHERE id = ${input.saleId} FOR UPDATE
  `;
  if (!locked) throw new SaleNotFoundError();
  if (locked.refundedAmount > 0n || locked.chargebackAmount > 0n)
    throw new Error("La venta tiene ajustes del proveedor y requiere revisión de posventa.");
  if (locked.status === "CANCELLED") throw new SaleCancelledCannotAcceptPaymentsError();
  if (locked.status === "DRAFT") throw new SaleNotConfirmedError();

  let payment: SalePayment;
  try {
    payment = await tx.salePayment.create({
      data: {
        saleId: input.saleId,
        method: input.method,
        amount: input.amount,
        reference: input.reference || null,
        notes: input.notes || null,
        paidAt: input.paidAt ?? new Date(),
        createdById: actorId,
        idempotencyKey: input.idempotencyKey,
      },
    });
  } catch (error) {
    if (isPaymentIdempotencyConflict(error)) throw new DuplicatePaymentSubmissionError();
    throw error;
  }

  const activeSum = await tx.salePayment.aggregate({
    where: { saleId: input.saleId, status: "ACTIVE" },
    _sum: { amount: true },
  });
  const paidAmount = activeSum._sum.amount ?? 0n;

  if (paidAmount > locked.totalAmount) {
    // Rolls back the whole transaction — the just-inserted payment row
    // included. An overpayment attempt leaves zero trace, per this
    // phase's explicit requirement.
    const alreadyPaid = paidAmount - input.amount;
    throw new PaymentExceedsRemainingBalanceError(locked.totalAmount - alreadyPaid, input.amount);
  }

  const paymentStatus = computeSalePaymentStatus(locked.totalAmount, paidAmount);
  await tx.sale.update({ where: { id: input.saleId }, data: { paidAmount, paymentStatus } });

  await recordAuditLog(
    {
      userId: actorId,
      action: "sale_payment.registered",
      entityType: "SalePayment",
      entityId: payment.id,
      newValue: {
        method: payment.method,
        amount: payment.amount.toString(),
        reference: payment.reference,
      },
      metadata: { saleId: input.saleId, paidAmount: paidAmount.toString(), paymentStatus },
    },
    tx,
  );

  return payment;
}

export async function registerSalePayment(
  input: RegisterSalePaymentInput,
  actorId: string,
): Promise<SalePayment> {
  return prisma.$transaction((tx) => registerSalePaymentWithinTransaction(tx, input, actorId));
}

// Voids an ACTIVE payment — the original row is never deleted or rewritten,
// only flagged (status/voidedAt/voidedById/voidReason) — and recomputes
// Sale.paidAmount/paymentStatus from the remaining ACTIVE set. Never touches
// inventory: inventory follows Sale.status (see sale-core.ts's
// confirmSale/cancelSale), never SalePayment.status, per this phase's
// explicit requirement that the two lifecycles stay independent.
//
// Concurrency: reads the payment once (just to find its saleId), then
// re-reads it AFTER acquiring the same `SELECT ... FOR UPDATE` sale-row lock
// registerSalePayment uses — never trusts the pre-lock read for the
// still-ACTIVE check, since a concurrent void of the same payment could have
// already committed in between. Two concurrent void attempts on the same
// payment: the first to acquire the lock wins; the second, once unblocked,
// sees status already VOIDED on its post-lock re-read and throws
// PaymentAlreadyVoidedError — never a double-void, never a double-subtract
// from the running total.
export async function voidSalePayment(
  id: string,
  reason: string,
  actorId: string,
): Promise<SalePayment> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new VoidReasonRequiredError();

  return prisma.$transaction(async (tx) => {
    const initial = await tx.salePayment.findUnique({ where: { id } });
    if (!initial) throw new SalePaymentNotFoundError();

    const [locked] = await tx.$queryRaw<SaleLockRow[]>`
      SELECT id, status, "totalAmount", "refundedAmount", "chargebackAmount" FROM sale WHERE id = ${initial.saleId} FOR UPDATE
    `;
    if (!locked) throw new SaleNotFoundError();
    if (locked.refundedAmount > 0n || locked.chargebackAmount > 0n)
      throw new Error("El pago tiene ajustes del proveedor y no puede anularse manualmente.");

    const payment = await tx.salePayment.findUniqueOrThrow({ where: { id } });
    if (payment.status === "VOIDED") throw new PaymentAlreadyVoidedError();

    await tx.salePayment.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedById: actorId,
        voidReason: trimmedReason,
      },
    });

    const activeSum = await tx.salePayment.aggregate({
      where: { saleId: payment.saleId, status: "ACTIVE" },
      _sum: { amount: true },
    });
    const paidAmount = activeSum._sum.amount ?? 0n;
    const paymentStatus = computeSalePaymentStatus(locked.totalAmount, paidAmount);
    await tx.sale.update({ where: { id: payment.saleId }, data: { paidAmount, paymentStatus } });

    await recordAuditLog(
      {
        userId: actorId,
        action: "sale_payment.voided",
        entityType: "SalePayment",
        entityId: id,
        previousValue: { status: "ACTIVE", amount: payment.amount.toString() },
        newValue: { status: "VOIDED", reason: trimmedReason },
        metadata: { saleId: payment.saleId, paidAmount: paidAmount.toString(), paymentStatus },
      },
      tx,
    );

    return tx.salePayment.findUniqueOrThrow({ where: { id } });
  });
}

export async function countActiveSalePayments(
  saleId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return client.salePayment.count({ where: { saleId, status: "ACTIVE" } });
}
