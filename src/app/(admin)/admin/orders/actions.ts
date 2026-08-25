"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { cancelOrder, getOrderById } from "@/modules/orders/order";
import { reconcileMercadoPagoPayment, type ReconcileResult } from "@/modules/payments/mercado-pago";

// Friendly Spanish translation for the service layer's typed errors — never
// a raw internal error string reaches the client.
function toFriendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    const knownErrors = ["OrderNotFoundError", "OrderNotCancellableError", "CancellationReasonRequiredError"];
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
  revalidatePath(`/admin/orders/${data.orderId}`);
  return result;
}
