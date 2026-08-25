import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";
import { expireOrderIfStale, OrderNotFoundError } from "@/modules/orders/order-core";

import { getMercadoPagoClient } from "./client-core";
import { getMercadoPagoConfig } from "./config-core";

export { OrderNotFoundError };

export class OrderNotPayableError extends Error {
  constructor() {
    super("Este pedido ya no está disponible para pagar.");
    this.name = "OrderNotPayableError";
  }
}

export class OrderRequiresReviewError extends Error {
  constructor() {
    super(
      "Este pedido requiere revisión y no puede pagarse nuevamente todavía. Contactá a la tienda.",
    );
    this.name = "OrderRequiresReviewError";
  }
}

export interface CreateMercadoPagoPreferenceInput {
  orderId: string;
  // The Order's own raw bearer token — see Order.accessTokenHash's schema
  // comment. Needed ONLY to build the /order/[token]/payment/return back
  // URLs; never used here for authorization (the caller already resolved a
  // real Order via getOrderByAccessToken before calling this, exactly like
  // every other public Order operation in this codebase).
  orderToken: string;
  // Client-generated (crypto.randomUUID() at "Pagar con Mercado Pago" click
  // time, resubmitted unchanged on retry) — see this integration's
  // idempotent-preference-creation policy below.
  idempotencyKey: string;
}

export interface CreateMercadoPagoPreferenceResult {
  checkoutUrl: string;
}

// Server-only operation — see this integration's own numbered requirements
// (load Order, verify PENDING_PAYMENT/payable, verify/expire reservation,
// use authoritative Order totals, create the preference, persist it, return
// only the safe checkout URL). Never trusts browser-provided amount, item
// prices, order total, customerId, Order status, or a Mercado Pago
// preference id — every one of those is resolved server-side from the
// already-created Order.
//
// Idempotent-preference-creation policy (two independent, complementary
// mechanisms):
//   1. idempotencyKey — a literal double-click/network retry of the SAME
//      "Pagar con Mercado Pago" click returns the EXACT SAME persisted
//      attempt, never a second preference, never a second call to Mercado
//      Pago at all.
//   2. Reuse — a DIFFERENT click (e.g. the customer left and came back to
//      /order/[token] in a new page load) for an Order that already has a
//      usable, non-terminal (CREATED/PENDING) attempt reuses THAT attempt's
//      persisted checkoutUrl instead of creating a redundant preference at
//      Mercado Pago. A genuinely new preference (this Order's prior attempt
//      is terminal/stale) supersedes any lingering non-terminal attempt
//      first — never two simultaneously "live" attempts for one Order.
export async function createMercadoPagoPreference(
  input: CreateMercadoPagoPreferenceInput,
): Promise<CreateMercadoPagoPreferenceResult> {
  const config = getMercadoPagoConfig();

  const existingByKey = await prisma.orderPaymentAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingByKey?.checkoutUrl) {
    return { checkoutUrl: existingByKey.checkoutUrl };
  }

  const { order } = await expireOrderIfStale(input.orderId);
  if (order.requiresPaymentReview) throw new OrderRequiresReviewError();
  if (order.status !== "PENDING_PAYMENT") throw new OrderNotPayableError();
  if (!order.reservationExpiresAt || order.reservationExpiresAt <= new Date()) {
    throw new OrderNotPayableError();
  }

  const activeReservationCount = await prisma.inventoryReservation.count({
    where: { orderId: order.id, status: "ACTIVE" },
  });
  if (activeReservationCount === 0) throw new OrderNotPayableError();

  const reusable = await prisma.orderPaymentAttempt.findFirst({
    where: { orderId: order.id, status: { in: ["CREATED", "PENDING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (reusable?.checkoutUrl) {
    return { checkoutUrl: reusable.checkoutUrl };
  }

  const baseUrl = config.publicBaseUrl.replace(/\/$/, "");
  const returnBase = `${baseUrl}/order/${input.orderToken}/payment/return`;

  const client = getMercadoPagoClient();
  const provider = await client.createPreference({
    externalReference: order.id,
    title: `Pedido ${order.code}`,
    unitPriceAmount: order.totalAmount,
    currency: order.currency,
    successUrl: `${returnBase}?hint=success`,
    pendingUrl: `${returnBase}?hint=pending`,
    failureUrl: `${returnBase}?hint=failure`,
    notificationUrl: `${baseUrl}/api/webhooks/mercado-pago`,
    // Aligned with this Order's actual reservation window (see this
    // integration's "align preference with reservation" requirement) —
    // never a second, independently-duplicated expiration constant. Not a
    // perfect guarantee for every Mercado Pago payment method (some offline
    // methods settle after their own provider-side deadline regardless —
    // see this integration's final report for that documented limitation),
    // but the server-side Order/reservation state remains authoritative
    // either way — see finalizePaidOrder's own late-payment policy.
    expiresFrom: new Date(),
    expiresTo: order.reservationExpiresAt,
    idempotencyKey: input.idempotencyKey,
  });

  const attempt = await prisma.$transaction(async (tx) => {
    // Defense-in-depth: supersede any other non-terminal attempt for this
    // Order. Should normally be none (the `reusable` check above already
    // returned early when one existed) — this only guards against an
    // unusual interleaving, never the common path.
    await tx.orderPaymentAttempt.updateMany({
      where: { orderId: order.id, status: { in: ["CREATED", "PENDING"] } },
      data: { status: "SUPERSEDED" },
    });

    const created = await tx.orderPaymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "MERCADO_PAGO",
        status: "CREATED",
        amount: order.totalAmount,
        currency: order.currency,
        providerPreferenceId: provider.preferenceId,
        checkoutUrl: provider.checkoutUrl,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await recordAuditLog(
      {
        userId: null,
        action: "order_payment_attempt.created",
        entityType: "OrderPaymentAttempt",
        entityId: created.id,
        newValue: { orderId: order.id, providerPreferenceId: provider.preferenceId },
      },
      tx,
    );

    return created;
  });

  // Non-null by construction: just persisted with a real checkoutUrl above.
  return { checkoutUrl: attempt.checkoutUrl! };
}
