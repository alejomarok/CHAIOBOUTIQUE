"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { archiveCategoryAction } from "./actions";

export function CategoryRowActions({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function handleArchive() {
    startTransition(async () => {
      try {
        await archiveCategoryAction({ id });
        toast.success("Categoría archivada.");
      } catch {
        toast.error("No pudimos archivar la categoría.");
      }
    });
  }

  return (
    <Button variant="ghost" size="sm" disabled={isPending} onClick={handleArchive}>
      Archivar
    </Button>
  );
}
