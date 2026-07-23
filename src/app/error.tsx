"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Error boundaries must be Client Components. Never render error.message to
// the user — it can leak internal details; the full error only goes to the
// server/browser console.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">Error</p>
      <h1 className="font-heading text-3xl font-semibold">Algo salió mal</h1>
      <p className="text-muted-foreground max-w-md">
        Ocurrió un error inesperado. Podés intentar de nuevo.
      </p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
