"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      className="text-muted-foreground h-10 gap-2"
      aria-label={isPending ? "Actualizando el panel" : "Actualizar datos del panel"}
    >
      <RefreshCw
        aria-hidden="true"
        className={cn("size-3.5", isPending && "motion-safe:animate-spin")}
      />
      <span>{isPending ? "Actualizando…" : "Actualizar"}</span>
    </Button>
  );
}
