import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
        Error 404
      </p>
      <h1 className="font-heading text-3xl font-semibold">Página no encontrada</h1>
      <p className="text-muted-foreground max-w-md">La página que buscás no existe o fue movida.</p>
      <Button asChild>
        <Link href="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}
