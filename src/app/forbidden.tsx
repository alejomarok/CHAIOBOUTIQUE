import Link from "next/link";

import { Button } from "@/components/ui/button";

// Rendered by next/navigation's forbidden() — see modules/auth/require-permission.ts.
// Requires experimental.authInterrupts in next.config.ts. Returns a real 403.
export default function Forbidden() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
        Error 403
      </p>
      <h1 className="font-heading text-3xl font-semibold">No tenés permiso para ver esta página</h1>
      <p className="text-muted-foreground max-w-md">
        Si creés que esto es un error, comunicate con quien administra tu cuenta.
      </p>
      <Button asChild>
        <Link href="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}
