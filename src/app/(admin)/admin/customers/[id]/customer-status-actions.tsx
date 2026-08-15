"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { activateCustomerAction, deactivateCustomerAction } from "../actions";

export function CustomerStatusActions({
  customerId,
  isActive,
}: {
  customerId: string;
  isActive: boolean;
}) {
  const [isPending, setIsPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function handleToggle() {
    if (isActive && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setIsPending(true);
    const action = isActive ? deactivateCustomerAction(customerId) : activateCustomerAction(customerId);
    action
      .then(() => toast.success(isActive ? "Cliente desactivado." : "Cliente activado."))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "No pudimos actualizar el estado."),
      )
      .finally(() => setIsPending(false));
  }

  if (isActive && confirming) {
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={isPending} onClick={handleToggle}>
          Confirmar desactivación
        </Button>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(false)}>
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" variant="outline" disabled={isPending} onClick={handleToggle}>
      {isActive ? "Desactivar cliente" : "Activar cliente"}
    </Button>
  );
}
