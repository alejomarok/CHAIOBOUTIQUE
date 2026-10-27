import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";
import { enqueueOrderEmails } from "@/modules/email/outbox-core";
import type { ProviderPayment } from "./types";

// Provider-side reversals are a separate immutable ledger. They never return physical stock.
export async function recordProviderAdjustment(orderId: string, payment: ProviderPayment) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const sale = await tx.sale.findUnique({ where: { orderId } });
    const collected = sale
      ? await tx.salePayment.findFirst({
          where: {
            saleId: sale.id,
            method: "MERCADO_PAGO",
            reference: payment.id,
            status: "ACTIVE",
          },
        })
      : null;
    if (
      !sale ||
      !collected ||
      payment.amount !== collected.amount ||
      payment.amount !== order.totalAmount ||
      payment.currency !== order.currency
    ) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          requiresPaymentReview: true,
          paymentReviewReason:
            "El ajuste del proveedor necesita conciliación manual de importe y moneda.",
        },
      });
      return { recorded: false };
    }
    await tx.$queryRaw`SELECT id FROM sale WHERE id = ${sale.id} FOR UPDATE`;
    const kind = payment.status === "charged_back" ? "CHARGEBACK" : "REFUND";
    const desired =
      kind === "CHARGEBACK" || payment.status === "refunded"
        ? payment.amount
        : (payment.refundedAmount ?? 0n);
    if (desired < 0n || desired > payment.amount)
      throw new Error("Invalid provider adjustment amount");
    const history = await tx.providerPaymentAdjustment.findMany({
      where: { orderId, providerPaymentId: payment.id },
    });
    const priorKind = history
      .filter((row) => row.kind === kind)
      .reduce((sum, row) => sum + row.amount, 0n);
    const otherKind = history
      .filter((row) => row.kind !== kind)
      .reduce((sum, row) => sum + row.amount, 0n);
    const capped = desired > payment.amount - otherKind ? payment.amount - otherKind : desired;
    const delta = capped - priorKind;
    if (delta <= 0n) return { recorded: false };
    const eventKey = `mp:${payment.id}:${kind}:${capped}`;
    await tx.providerPaymentAdjustment.create({
      data: {
        eventKey,
        orderId,
        saleId: sale.id,
        providerPaymentId: payment.id,
        kind,
        amount: delta,
        currency: payment.currency,
      },
    });
    const all = await tx.providerPaymentAdjustment.findMany({ where: { saleId: sale.id } });
    const refundedAmount = all
      .filter((row) => row.kind === "REFUND")
      .reduce((sum, row) => sum + row.amount, 0n);
    const chargebackAmount = all
      .filter((row) => row.kind === "CHARGEBACK")
      .reduce((sum, row) => sum + row.amount, 0n);
    const gross = await tx.salePayment.aggregate({
      where: { saleId: sale.id, status: "ACTIVE" },
      _sum: { amount: true },
    });
    const paidAmount = (gross._sum.amount ?? 0n) - refundedAmount - chargebackAmount;
    if (paidAmount < 0n) throw new Error("Adjustment exceeds collected payment");
    const paymentStatus =
      chargebackAmount > 0n
        ? "CHARGED_BACK"
        : paidAmount === 0n
          ? "REFUNDED"
          : "PARTIALLY_REFUNDED";
    await tx.sale.update({
      where: { id: sale.id },
      data: { refundedAmount, chargebackAmount, paidAmount, paymentStatus },
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus,
        requiresPaymentReview: true,
        paymentReviewReason:
          kind === "CHARGEBACK"
            ? "Mercado Pago informó un contracargo. Revisá la operación antes de entregar."
            : "Mercado Pago informó un reembolso. Coordiná la devolución física si corresponde; el stock no se repuso automáticamente.",
      },
    });
    if (paidAmount === 0n)
      await tx.orderPaymentAttempt.updateMany({
        where: { orderId, providerPaymentId: payment.id },
        data: { status: "REFUNDED" },
      });
    await recordAuditLog(
      {
        userId: null,
        action: "payment.provider_adjustment",
        entityType: "Order",
        entityId: orderId,
        newValue: { kind, amount: delta.toString(), paymentStatus },
        metadata: { providerPaymentId: payment.id, eventKey },
      },
      tx,
    );
    await enqueueOrderEmails(tx, orderId, "adjusted", eventKey);
    return { recorded: true };
  });
}
