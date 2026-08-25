"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { cancelOrderAction } from "../actions";

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  if (!isConfirming) {
    return (
      <Button variant="outline" onClick={() => setIsConfirming(true)}>
        Cancelar pedido
      </Button>
    );
  }

  function handleConfirm() {
    if (!reason.trim()) {
      toast.error("El motivo de cancelación es obligatorio.");
      return;
    }
    setIsPending(true);
    cancelOrderAction({ id: orderId, reason: reason.trim() })
      .then(() => toast.success("Pedido cancelado."))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "No pudimos cancelar el pedido."),
      )
      .finally(() => setIsPending(false));
  }

  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">¿Confirmás que querés cancelar este pedido?</p>
      {/* Releases the reservation — never a physical inventory movement,
          since reserved stock was never deducted. See modules/orders/
          order-core.ts's cancelOrder. */}
      <Input
        placeholder="Motivo de cancelación (obligatorio)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={isPending}
      />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending || !reason.trim()}
          onClick={handleConfirm}
        >
          {isPending ? "Cancelando…" : "Confirmar cancelación"}
        </Button>
        <Button variant="ghost" size="sm" disabled={isPending} onClick={() => setIsConfirming(false)}>
          Volver
        </Button>
      </div>
    </div>
  );
}
