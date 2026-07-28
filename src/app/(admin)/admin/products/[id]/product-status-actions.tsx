"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { setProductStatusAction } from "../actions";

const STATUS_LABELS_ES: Record<string, string> = {
  DRAFT: "Borrador",
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  ARCHIVED: "Archivado",
};

export function ProductStatusActions({
  productId,
  status,
  canPublish,
  canArchive,
}: {
  productId: string;
  status: string;
  canPublish: boolean;
  canArchive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function changeStatus(nextStatus: "ACTIVE" | "INACTIVE" | "ARCHIVED") {
    startTransition(async () => {
      try {
        await setProductStatusAction({ id: productId, status: nextStatus });
        toast.success(`Estado actualizado a "${STATUS_LABELS_ES[nextStatus]}".`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos actualizar el estado.");
      }
    });
  }

  return (
    <div className="flex gap-2">
      {canPublish && status !== "ACTIVE" && status !== "ARCHIVED" && (
        <Button size="sm" disabled={isPending} onClick={() => changeStatus("ACTIVE")}>
          Publicar
        </Button>
      )}
      {canPublish && status === "ACTIVE" && (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => changeStatus("INACTIVE")}
        >
          Despublicar
        </Button>
      )}
      {canArchive && status !== "ARCHIVED" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => changeStatus("ARCHIVED")}
        >
          Archivar
        </Button>
      )}
    </div>
  );
}
