"use server";

import { z } from "zod";

import { getOrderByAccessToken } from "@/modules/orders/order";
import { createMercadoPagoPreference } from "@/modules/payments/mercado-pago";

// Friendly Spanish translation for the service layer's typed errors — never
// a raw internal error string reaches the client. Mirrors app/(public)/
// checkout/actions.ts's exact toFriendlyMessage pattern.
function toFriendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "OrderNotPayableError") {
      return "Este pedido ya no está disponible para pagar. Si ya lo pagaste, actualizá la página.";
    }
    if (error.name === "OrderRequiresReviewError") return error.message;
    if (error.name === "MercadoPagoNotConfiguredError") {
      return "El pago con Mercado Pago no está disponible en este momento.";
    }
  }
  return "No pudimos iniciar el pago. Intentá nuevamente.";
}

const inputSchema = z.object({
  token: z.string().min(1),
  // Client-generated (crypto.randomUUID() at "Pagar con Mercado Pago"
  // render/click time, resubmitted unchanged on retry) — see
  // createMercadoPagoPreference's own idempotent-preference-creation
  // policy for why a double-click never creates two preferences.
  idempotencyKey: z.string().min(1),
});

export interface CreateMercadoPagoCheckoutResult {
  checkoutUrl: string;
}

// Token possession IS the authorization here — see Order.accessTokenHash's
// own schema comment, same posture as every other public Order operation.
// orderId/orderToken are never accepted directly from the client for this
// reason: they're both derived from the one token-based lookup below.
export async function createMercadoPagoCheckoutAction(
  input: z.infer<typeof inputSchema>,
): Promise<CreateMercadoPagoCheckoutResult> {
  const data = inputSchema.parse(input);

  const order = await getOrderByAccessToken(data.token);
  if (!order) throw new Error("Pedido no encontrado.");

  try {
    const result = await createMercadoPagoPreference({
      orderId: order.id,
      orderToken: data.token,
      idempotencyKey: data.idempotencyKey,
    });
    return { checkoutUrl: result.checkoutUrl };
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
}
