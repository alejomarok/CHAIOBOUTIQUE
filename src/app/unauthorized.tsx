import Link from "next/link";

import { Button } from "@/components/ui/button";

// Rendered by next/navigation's unauthorized() — see modules/auth/require-permission.ts.
// Requires experimental.authInterrupts in next.config.ts. Returns a real 401.
export default function Unauthorized() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
        Error 401
      </p>
      <h1 className="font-heading text-3xl font-semibold">Necesitás iniciar sesión</h1>
      <p className="text-muted-foreground max-w-md">
        Tu sesión expiró o no iniciaste sesión todavía.
      </p>
      <Button asChild>
        <Link href="/login">Iniciar sesión</Link>
      </Button>
    </div>
  );
}
