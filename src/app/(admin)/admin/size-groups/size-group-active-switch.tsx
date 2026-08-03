"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

import { toggleSizeGroupActiveAction } from "./actions";

export function SizeGroupActiveSwitch({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      try {
        await toggleSizeGroupActiveAction({ id, isActive: checked });
      } catch {
        toast.error("No pudimos actualizar el grupo de talles.");
      }
    });
  }

  return <Switch checked={isActive} disabled={isPending} onCheckedChange={handleChange} />;
}
