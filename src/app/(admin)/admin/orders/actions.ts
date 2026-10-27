"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit/index-core";
import { updateOrderFulfillment } from "@/modules/orders/fulfillment-core";
import { enqueueOrderEmails, processEmailOutbox } from "@/modules/email/outbox-core";
import { cancelOrder, getOrderById } from "@/modules/orders/order";
import { reconcileMercadoPagoPayment, type ReconcileResult } from "@/modules/payments/mercado-pago";

// Friendly Spanish translation for the service layer's typed errors — never
// a raw internal error string reaches the client.
function toFriendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    const knownErrors = [
      "OrderNotFoundError",
      "OrderNotCancellableError",
      "CancellationReasonRequiredError",
    ];
    if (knownErrors.includes(error.name)) return error.message;
  }
  return "No pudimos cancelar el pedido. Intentá de nuevo.";
}

const cancelSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1, "El motivo de cancelación es obligatorio."),
});

export async function cancelOrderAction(input: z.infer<typeof cancelSchema>) {
  const actor = await requirePermission("orders.cancel");
  const data = cancelSchema.parse(input);
  try {
    await cancelOrder(data.id, data.reason, actor.id);
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${data.id}`);
}

const verifyPaymentSchema = z.object({
  orderId: z.string().min(1),
});

// Server-side permission required (orders.manage) — see this integration's
// "admin reconciliation action" requirement. Resolves the provider payment
// id from THIS Order's own persisted OrderPaymentAttempt rows — never
// accepts one from the browser — then calls the exact same reconciliation
// service the webhook itself uses (modules/payments/mercado-pago/
// reconcile-core.ts), never a second, parallel verification path.
export async function verifyOrderPaymentAction(
  input: z.infer<typeof verifyPaymentSchema>,
): Promise<ReconcileResult> {
  await requirePermission("orders.manage");
  const data = verifyPaymentSchema.parse(input);

  const order = await getOrderById(data.orderId);
  if (!order) throw new Error("Pedido no encontrado.");

  const attempt = order.paymentAttempts.find((a) => a.providerPaymentId);
  if (!attempt?.providerPaymentId) {
    throw new Error("Este pedido no tiene un pago de Mercado Pago para verificar.");
  }

  const result = await reconcileMercadoPagoPayment(attempt.providerPaymentId);
  after(async () => {
    await processEmailOutbox(2);
  });
  revalidatePath(`/admin/orders/${data.orderId}`);
  return result;
}

const fulfillmentSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "DELIVERED"]),
  carrier: z.string().trim().max(120).optional(),
  trackingNumber: z.string().trim().max(150).optional(),
  trackingUrl: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    }, "Usá un enlace de seguimiento HTTPS válido."),
});

export async function updateFulfillmentAction(input: z.infer<typeof fulfillmentSchema>) {
  const actor = await requirePermission("orders.manage");
  const data = fulfillmentSchema.parse(input);
  await updateOrderFulfillment(data, actor.id);
  revalidatePath(`/admin/orders/${data.orderId}`);
  revalidatePath("/admin/orders");
  after(async () => {
    await processEmailOutbox(2);
  });
}

export async function resolveAdjustmentAction(form: FormData) {
  const actor = await requirePermission("orders.manage");
  const data = z
    .object({
      orderId: z.string().min(1),
      decision: z.enum(["CANCEL", "CONTINUE"]),
      confirmed: z.literal("on"),
    })
    .parse(Object.fromEntries(form));
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${data.orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: data.orderId } });
    if (!order.requiresPaymentReview) return;
    if (!["REFUNDED", "PARTIALLY_REFUNDED", "CHARGED_BACK"].includes(order.paymentStatus))
      throw new Error("El pedido no tiene un ajuste financiero para revisar.");
    if (data.decision === "CONTINUE" && order.paymentStatus !== "PARTIALLY_REFUNDED")
      throw new Error(
        "Una devolución total o un contracargo no permiten continuar la entrega desde este flujo.",
      );
    await tx.order.update({
      where: { id: order.id },
      data: {
        requiresPaymentReview: false,
        ...(data.decision === "CANCEL" && order.status !== "DELIVERED"
          ? {
              status: "CANCELLED",
              cancelledAt: new Date(),
              cancelledById: actor.id,
              cancellationReason: "Entrega cancelada luego de revisar el ajuste del pago.",
            }
          : {}),
      },
    });
    await recordAuditLog(
      {
        userId: actor.id,
        action: "order.adjustment_reviewed",
        entityType: "Order",
        entityId: order.id,
        newValue: { decision: data.decision, inventoryAutomaticallyRestored: false },
      },
      tx,
    );
    await enqueueOrderEmails(
      tx,
      order.id,
      "updated",
      `review:${order.updatedAt.toISOString()}:${data.decision}`,
    );
  });
  revalidatePath(`/admin/orders/${data.orderId}`);
  revalidatePath("/admin/orders");
  after(async () => {
    await processEmailOutbox(2);
  });
}
