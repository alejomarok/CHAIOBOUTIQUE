import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";
import { finalizePaidOrder } from "@/modules/orders/order-core";

import { getMercadoPagoClient } from "./client-core";
import { mapMercadoPagoPaymentStatus } from "./status-mapping-core";

// Reusable server-side reconciliation service — see this integration's
// "payment reconciliation service" requirement. The webhook route
// (src/app/api/webhooks/mercado-pago/route.ts) calls this after validating
// the notification's signature; the admin "Verificar pago" action
// (src/app/(admin)/admin/orders/actions.ts) calls the SAME function for a
// manual retry. Neither caller ever finalizes an Order directly — this is
// the one place that: queries Mercado Pago server-to-server, validates
// correlation, maps provider status, updates the OrderPaymentAttempt
// safely, and calls finalizePaidOrder only when approved and valid.

export type ReconcileOutcome =
  | "approved_finalized"
  | "already_finalized"
  | "pending"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "requires_review"
  | "not_found"
  | "unknown_status";

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  orderId?: string;
}

// Resolves which OrderPaymentAttempt a given provider payment id belongs
// to. Preferred: an attempt already carrying this exact providerPaymentId
// (a repeat notification for a payment already reconciled once). Otherwise,
// the most recent non-SUPERSEDED attempt for the correlated Order — a
// preference's first-ever payment notification for it. Never resolves an
// attempt from providerPaymentId alone without also having confirmed the
// Order via external_reference first — see reconcileMercadoPagoPayment's
// own "do not rely on external_reference alone" note for the full
// correlation chain.
async function resolveAttempt(orderId: string, providerPaymentId: string) {
  const byPaymentId = await prisma.orderPaymentAttempt.findUnique({ where: { providerPaymentId } });
  if (byPaymentId && byPaymentId.orderId === orderId) return byPaymentId;

  return prisma.orderPaymentAttempt.findFirst({
    where: { orderId, status: { not: "SUPERSEDED" } },
    orderBy: { createdAt: "desc" },
  });
}

// providerPaymentId comes from the webhook's own `data.id` (already
// signature-verified by the caller) or from a persisted OrderPaymentAttempt
// row (the admin "Verificar pago" action — never an arbitrary id supplied
// by a browser). This function itself never trusts the notification body's
// claimed amount/status — it re-fetches the payment server-to-server via
// the Mercado Pago API (or the deterministic fake in tests/e2e) before
// acting on anything.
//
// Correlation chain (see this integration's explicit "do not rely on
// external_reference alone for authorization" requirement): (1) the
// provider payment id itself is looked up server-to-server — this proves
// the payment DATA is genuine, not just the notification wrapper; (2) its
// external_reference resolves which Order this concerns; (3)
// finalizePaidOrder's own mandatory amount/currency verification (against
// the Order's real, authoritative totalAmount/currency — never the
// notification) is the actual anti-tampering check beyond bare
// external_reference matching.
export async function reconcileMercadoPagoPayment(providerPaymentId: string): Promise<ReconcileResult> {
  const client = getMercadoPagoClient();
  const payment = await client.getPayment(providerPaymentId);
  if (!payment || !payment.externalReference) {
    return { outcome: "not_found" };
  }

  const order = await prisma.order.findUnique({ where: { id: payment.externalReference } });
  if (!order) return { outcome: "not_found" };

  const attempt = await resolveAttempt(order.id, payment.id);
  if (!attempt) return { outcome: "not_found" };

  // Sticky — see PaymentAttemptStatus.APPROVED's own schema comment: never
  // regress an already-APPROVED attempt, regardless of what a late/
  // duplicate/out-of-order notification now reports.
  if (attempt.status === "APPROVED") {
    return { outcome: "already_finalized", orderId: order.id };
  }

  const mappedStatus = mapMercadoPagoPaymentStatus(payment.status);

  if (mappedStatus === null) {
    await prisma.orderPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        providerPaymentId: payment.id,
        failureCode: "UNKNOWN_PROVIDER_STATUS",
        failureDetail: payment.statusDetail ?? payment.status,
      },
    });
    await recordAuditLog({
      userId: null,
      action: "order_payment_attempt.unknown_status",
      entityType: "OrderPaymentAttempt",
      entityId: attempt.id,
      metadata: { providerStatus: payment.status },
    });
    return { outcome: "unknown_status", orderId: order.id };
  }

  if (mappedStatus === "APPROVED") {
    await recordAuditLog({
      userId: null,
      action: "order_payment_attempt.approved",
      entityType: "OrderPaymentAttempt",
      entityId: attempt.id,
      metadata: { orderId: order.id, providerPaymentId: payment.id },
    });

    // finalizePaidOrder itself updates OrderPaymentAttempt to APPROVED on
    // success, or to FAILED_RECONCILIATION on an amount/currency mismatch
    // or insufficient-stock late-payment case — never duplicated here.
    const result = await finalizePaidOrder({
      orderId: order.id,
      paymentContext: {
        provider: "MERCADO_PAGO",
        attemptId: attempt.id,
        providerPaymentId: payment.id,
        approvedAmount: payment.amount,
        approvedCurrency: payment.currency,
        approvedAt: payment.approvedAt ?? new Date(),
      },
    });

    if (result.outcome === "finalized") {
      await recordAuditLog({
        userId: null,
        action: "order.finalized",
        entityType: "Order",
        entityId: order.id,
        metadata: { saleId: result.sale?.id ?? null },
      });
      return { outcome: "approved_finalized", orderId: order.id };
    }
    if (result.outcome === "already_finalized") return { outcome: "already_finalized", orderId: order.id };
    return { outcome: "requires_review", orderId: order.id };
  }

  // pending/rejected/cancelled/refunded — reflect the attempt's current
  // status; never touch Order.status/paymentStatus/reservations. The Order
  // stays payable while its own reservation remains valid — see this
  // integration's documented "do not release reservation immediately
  // merely because one payment attempt was rejected" policy.
  await prisma.orderPaymentAttempt.update({
    where: { id: attempt.id },
    data: { status: mappedStatus, providerPaymentId: payment.id },
  });
  await recordAuditLog({
    userId: null,
    action: "order_payment_attempt.updated",
    entityType: "OrderPaymentAttempt",
    entityId: attempt.id,
    newValue: { status: mappedStatus },
  });

  switch (mappedStatus) {
    case "PENDING":
      return { outcome: "pending", orderId: order.id };
    case "REJECTED":
      return { outcome: "rejected", orderId: order.id };
    case "CANCELLED":
      return { outcome: "cancelled", orderId: order.id };
    case "REFUNDED":
      return { outcome: "refunded", orderId: order.id };
  }
}
