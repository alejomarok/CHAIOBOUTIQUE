"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { setDefaultWarehouseAction, toggleWarehouseActiveAction } from "./actions";

export function WarehouseRowActions({
  id,
  isDefault,
  isActive,
}: {
  id: string;
  isDefault: boolean;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleSetDefault() {
    startTransition(async () => {
      try {
        await setDefaultWarehouseAction({ id });
        toast.success("Depósito predeterminado actualizado.");
      } catch {
        toast.error("No pudimos actualizar el depósito predeterminado.");
      }
    });
  }

  function handleToggleActive() {
    startTransition(async () => {
      try {
        await toggleWarehouseActiveAction({ id, isActive: !isActive });
      } catch {
        toast.error("No pudimos actualizar el depósito.");
      }
    });
  }

  return (
    <div className="flex gap-2">
      {!isDefault && (
        <Button variant="outline" size="sm" disabled={isPending} onClick={handleSetDefault}>
          Predeterminar
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending || isDefault}
        onClick={handleToggleActive}
      >
        {isActive ? "Desactivar" : "Activar"}
      </Button>
    </div>
  );
}
