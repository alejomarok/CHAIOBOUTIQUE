"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { verifyOrderPaymentAction } from "../actions";

const OUTCOME_MESSAGES_ES: Record<string, string> = {
  approved_finalized: "Pago verificado y pedido confirmado.",
  already_finalized: "Este pedido ya estaba confirmado.",
  pending: "Mercado Pago todavía reporta el pago como pendiente.",
  rejected: "Mercado Pago reporta el pago como rechazado.",
  cancelled: "Mercado Pago reporta el pago como cancelado.",
  refunded: "Mercado Pago reporta el pago como reembolsado.",
  requires_review: "El pago requiere revisión manual.",
  not_found: "No se encontró el pago en Mercado Pago.",
  unknown_status: "Mercado Pago reportó un estado no reconocido.",
};

// Calls the SAME reconciliation service the webhook uses (see
// modules/payments/mercado-pago/reconcile-core.ts) — never a second,
// admin-only verification path. The provider payment id is resolved
// server-side from this Order's own persisted OrderPaymentAttempt rows
// (see verifyOrderPaymentAction), never accepted from this component.
export function VerifyPaymentButton({ orderId }: { orderId: string }) {
  const [isPending, setIsPending] = useState(false);

  function handleClick() {
    setIsPending(true);
    verifyOrderPaymentAction({ orderId })
      .then((result) => {
        toast.success(OUTCOME_MESSAGES_ES[result.outcome] ?? "Verificación completada.");
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "No pudimos verificar el pago."))
      .finally(() => setIsPending(false));
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      {isPending ? "Verificando…" : "Verificar pago"}
    </Button>
  );
}
