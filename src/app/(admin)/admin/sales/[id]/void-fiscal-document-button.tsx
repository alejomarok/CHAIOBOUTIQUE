"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { voidFiscalDocumentAction } from "../actions";

// Administrative correction only — mirrors void-payment-button.tsx's exact
// pattern. Never a real ARCA electronic-invoice cancellation or a credit/
// debit note.
export function VoidFiscalDocumentButton({ fiscalDocumentId }: { fiscalDocumentId: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  if (!isConfirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setIsConfirming(true)}>
        Anular comprobante
      </Button>
    );
  }

  function handleConfirm() {
    if (!reason.trim()) {
      toast.error("El motivo de anulación es obligatorio.");
      return;
    }
    setIsPending(true);
    voidFiscalDocumentAction({ id: fiscalDocumentId, reason: reason.trim() })
      .then(() => toast.success("Comprobante anulado."))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "No pudimos anular el comprobante."),
      )
      .finally(() => setIsPending(false));
  }

  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">¿Confirmás que querés anular este comprobante?</p>
      <p className="text-muted-foreground text-xs">
        Esto es una corrección administrativa, no una nota de crédito ni una anulación fiscal ante ARCA.
      </p>
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
