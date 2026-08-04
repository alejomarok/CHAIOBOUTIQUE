"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { deleteSizeGroupAction } from "../actions";

// This is the only hard-delete in the size-groups admin UI (options are
// only ever activated/deactivated, matching the rest of this codebase's
// lookup-table convention) — reserved for a group that turned out to be a
// mistake (e.g. an accidental duplicate) before it was ever wired to real
// data. The server independently re-checks both conditions below
// (products using the group, options still in it) — this disabled state
// is UX only, never the actual enforcement.
export function DeleteSizeGroupButton({
  sizeGroupId,
  productCount,
  optionCount,
}: {
  sizeGroupId: string;
  productCount: number;
  optionCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const blockedReason =
    productCount > 0
      ? "Hay productos que usan este grupo — no se puede eliminar."
      : optionCount > 0
        ? "El grupo todavía tiene talles — eliminalos primero."
        : null;

  async function handleDelete() {
    setIsSubmitting(true);
    try {
      await deleteSizeGroupAction({ id: sizeGroupId });
      toast.success("Grupo de talles eliminado.");
      setOpen(false);
      router.push("/admin/size-groups");
    } catch {
      toast.error("No pudimos eliminar el grupo de talles.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const trigger = (
    <Button type="button" variant="destructive" size="sm" disabled={blockedReason !== null}>
      Eliminar grupo
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {blockedReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper: a disabled button doesn't fire hover events */}
            <span className="inline-flex">{trigger}</span>
          </TooltipTrigger>
          <TooltipContent>{blockedReason}</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Eliminar este grupo de talles?</DialogTitle>
          <DialogDescription>
            Esta acción no se puede deshacer. El grupo no tiene productos ni talles asociados, así
            que es seguro eliminarlo.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" disabled={isSubmitting} onClick={handleDelete}>
            {isSubmitting ? "Eliminando…" : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
