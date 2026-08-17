"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

import { updateCategoryAction } from "./actions";

export function StorefrontNavToggle({
  id,
  checked,
  disabled,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    startTransition(async () => {
      try {
        await updateCategoryAction({ id, showInStorefrontNav: next });
        toast.success(next ? "Ahora aparece en la navegación pública." : "Ya no aparece en la navegación pública.");
      } catch {
        toast.error("No pudimos actualizar la categoría.");
      }
    });
  }

  return (
    <Switch
      checked={checked}
      onCheckedChange={handleChange}
      disabled={disabled || isPending}
      aria-label="Mostrar en navegación pública"
    />
  );
}
