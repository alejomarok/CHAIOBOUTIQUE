import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import { Button } from "@/components/ui/button";
import { listPublicProducts } from "@/modules/products/public-queries";

// The hero's right-side visual is a REAL catalog product image when one
// exists (never a stock photo or invented asset) — falls back to a purely
// abstract, non-photographic decorative composition when the catalog has
// no presentable image yet, per "gracefully reduce rather than invent."
export async function Hero() {
  const [heroProduct] = await listPublicProducts({ take: 1 });

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="bg-accent-cyan pointer-events-none absolute -top-24 -left-24 size-96 rounded-full opacity-15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="bg-accent-pink pointer-events-none absolute -right-20 top-10 size-80 rounded-full opacity-20 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pt-16 pb-10 sm:px-6 sm:pt-24 sm:pb-14 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:pt-28 lg:pb-16">
        <div className="flex flex-col items-start gap-6">
          <p className="text-accent-cyan text-xs font-semibold tracking-[0.2em] uppercase">
            Moda femenina
          </p>
          <h1 className="font-heading max-w-xl text-4xl leading-[1.08] font-semibold text-balance sm:text-5xl lg:text-6xl">
            Estilo que habla de vos.
          </h1>
          <p className="text-muted-foreground max-w-md text-lg text-pretty">
            Prendas pensadas para acompañarte todos los días, con diseño, comodidad y
            personalidad.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild size="lg">
              <Link href="/catalog?sort=newest">Ver novedades</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/catalog">Explorar colección</Link>
            </Button>
          </div>
        </div>

        <div className="relative mx-auto aspect-[4/5] w-full max-w-sm lg:max-w-none">
          {heroProduct ? (
            <Link
              href={`/product/${heroProduct.slug}`}
              className="bg-blush ring-border/60 group relative block h-full w-full overflow-hidden rounded-3xl ring-1"
            >
              <ProductImage
                src={heroProduct.primaryImageUrl}
                alt={heroProduct.name}
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                priority
              />
            </Link>
          ) : (
            <div className="from-blush via-background to-accent-cyan/15 ring-border/60 relative h-full w-full overflow-hidden rounded-3xl bg-gradient-to-br ring-1">
              <div
                aria-hidden="true"
                className="bg-accent-yellow absolute top-1/4 left-1/4 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-2xl"
              />
              <div
                aria-hidden="true"
                className="bg-accent-lime absolute bottom-1/4 right-1/4 size-28 translate-x-1/2 translate-y-1/2 rounded-full opacity-30 blur-2xl"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
