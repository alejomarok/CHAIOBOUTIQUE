"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { cancelSaleAction } from "../actions";

export function CancelSaleButton({ saleId }: { saleId: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  if (!isConfirming) {
    return (
      <Button variant="outline" onClick={() => setIsConfirming(true)}>
        Cancelar venta
      </Button>
    );
  }

  function handleConfirm() {
    if (!reason.trim()) {
      toast.error("El motivo de cancelación es obligatorio.");
      return;
    }
    setIsPending(true);
    cancelSaleAction({ id: saleId, reason: reason.trim() })
      .then(() => toast.success("Venta cancelada."))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "No pudimos cancelar la venta."),
      )
      .finally(() => setIsPending(false));
  }

  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">¿Confirmás que querés cancelar esta venta?</p>
      {/* CONFIRMED sales restore stock on cancellation — see
          modules/sales/sale-core.ts's cancelSale. */}
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
