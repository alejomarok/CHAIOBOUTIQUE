import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="from-secondary/60 via-background to-background bg-gradient-to-b">
      <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-24 sm:px-6 sm:py-32">
        <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
          Moda femenina
        </p>
        <h1 className="font-heading max-w-2xl text-4xl leading-tight font-semibold text-balance sm:text-5xl">
          Elegancia simple, para el día a día.
        </h1>
        <p className="text-muted-foreground max-w-xl text-lg text-pretty">
          Estamos construyendo la nueva tienda online de CHAIOBOUTIQUE. Muy pronto vas a poder
          descubrir toda la colección acá.
        </p>
        <Button asChild size="lg">
          <Link href="/catalog">Ver catálogo</Link>
        </Button>
      </section>
    </div>
  );
}
