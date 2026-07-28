"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

import { toggleBrandActiveAction } from "./actions";

export function BrandActiveSwitch({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      try {
        await toggleBrandActiveAction({ id, isActive: checked });
      } catch {
        toast.error("No pudimos actualizar la marca.");
      }
    });
  }

  return <Switch checked={isActive} disabled={isPending} onCheckedChange={handleChange} />;
}
