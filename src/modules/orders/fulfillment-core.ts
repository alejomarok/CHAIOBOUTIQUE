import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";
import { enqueueOrderEmails } from "@/modules/email/outbox-core";

export const FULFILLMENT_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  PAID: ["PROCESSING"],
  PROCESSING: ["READY_FOR_PICKUP", "SHIPPED"],
  READY_FOR_PICKUP: ["DELIVERED"],
  SHIPPED: ["DELIVERED"],
};

export async function updateOrderFulfillment(
  input: {
    orderId: string;
    status: OrderStatus;
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
  },
  actorId: string,
) {
  if (input.trackingUrl) {
    const url = new URL(input.trackingUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      input.trackingUrl.length > 2048
    )
      throw new Error("Usá un enlace de seguimiento HTTPS válido.");
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (order.status === input.status) return order;
    if (
      !["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus) ||
      order.requiresPaymentReview
    )
      throw new Error("Revisá el pago antes de continuar con la entrega.");
    if (!FULFILLMENT_TRANSITIONS[order.status]?.includes(input.status))
      throw new Error("El cambio de estado no está permitido.");
    if (input.status === "SHIPPED" && order.deliveryMethod !== "HOME_DELIVERY")
      throw new Error("Este pedido es para retirar en el local.");
    if (input.status === "READY_FOR_PICKUP" && order.deliveryMethod !== "PICKUP")
      throw new Error("Este pedido es para envío a domicilio.");
    const data = {
      status: input.status,
      ...(input.status === "SHIPPED"
        ? {
            trackingCarrier: input.carrier?.trim() || null,
            trackingNumber: input.trackingNumber?.trim() || null,
            trackingUrl: input.trackingUrl?.trim() || null,
            shippedAt: new Date(),
          }
        : {}),
      ...(input.status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
    };
    const updated = await tx.order.update({ where: { id: input.orderId }, data });
    await recordAuditLog(
      {
        userId: actorId,
        action: "order.fulfillment_updated",
        entityType: "Order",
        entityId: order.id,
        previousValue: { status: order.status },
        newValue: { status: input.status },
      },
      tx,
    );
    await enqueueOrderEmails(tx, order.id, "updated", input.status);
    return updated;
  });
}
