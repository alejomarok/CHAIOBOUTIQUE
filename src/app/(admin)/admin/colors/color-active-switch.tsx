"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

import { toggleColorActiveAction } from "./actions";

export function ColorActiveSwitch({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      try {
        await toggleColorActiveAction({ id, isActive: checked });
      } catch {
        toast.error("No pudimos actualizar el color.");
      }
    });
  }

  return <Switch checked={isActive} disabled={isPending} onCheckedChange={handleChange} />;
}
