"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { voidSalePaymentAction } from "../actions";

export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  if (!isConfirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setIsConfirming(true)}>
        Anular pago
      </Button>
    );
  }

  function handleConfirm() {
    if (!reason.trim()) {
      toast.error("El motivo de anulación es obligatorio.");
      return;
    }
    setIsPending(true);
    voidSalePaymentAction({ paymentId, reason: reason.trim() })
      .then(() => toast.success("Pago anulado."))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "No pudimos anular el pago."),
      )
      .finally(() => setIsPending(false));
  }

  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">¿Confirmás que querés anular este pago?</p>
      <Input
        placeholder="Motivo de anulación (obligatorio)"
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
          {isPending ? "Anulando…" : "Confirmar anulación"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => setIsConfirming(false)}
        >
          Volver
        </Button>
      </div>
    </div>
  );
}
