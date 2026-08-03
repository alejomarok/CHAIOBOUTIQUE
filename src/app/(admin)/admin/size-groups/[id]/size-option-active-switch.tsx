"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

import { toggleSizeOptionActiveAction } from "../actions";

export function SizeOptionActiveSwitch({
  id,
  sizeGroupId,
  isActive,
}: {
  id: string;
  sizeGroupId: string;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      try {
        await toggleSizeOptionActiveAction({ id, sizeGroupId, isActive: checked });
      } catch {
        toast.error("No pudimos actualizar el talle.");
      }
    });
  }

  return <Switch checked={isActive} disabled={isPending} onCheckedChange={handleChange} />;
}
