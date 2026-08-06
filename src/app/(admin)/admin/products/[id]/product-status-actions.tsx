"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { publishProductAction, setProductStatusAction } from "../actions";

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

  function changeStatus(nextStatus: "INACTIVE" | "ARCHIVED") {
    startTransition(async () => {
      try {
        await setProductStatusAction({ id: productId, status: nextStatus });
        toast.success(`Estado actualizado a "${STATUS_LABELS_ES[nextStatus]}".`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos actualizar el estado.");
      }
    });
  }

  // Distinct from changeStatus: validates every public-visibility
  // requirement server-side in one pass and, if anything is missing, shows
  // every blocker together instead of a single generic error — see
  // publishProductAction's own doc comment.
  function handlePublish() {
    startTransition(async () => {
      try {
        const result = await publishProductAction(productId);
        if (result.status === "blocked") {
          toast.error(
            `No se puede publicar: ${result.blockers.map((b) => b.message).join(" ")}`,
          );
          return;
        }
        toast.success("Producto publicado.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos publicar el producto.");
      }
    });
  }

  return (
    <div className="flex gap-2">
      {canPublish && status !== "ACTIVE" && status !== "ARCHIVED" && (
        <Button size="sm" disabled={isPending} onClick={handlePublish}>
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
