import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import { ProductCard } from "@/components/catalog/product-card";
import { listPublicProducts } from "@/modules/products/public-queries";

export async function FeaturedProducts() {
  const products = await listPublicProducts({ take: 4, sort: "newest" });
  return (
    <section
      id="novedades"
      className="scroll-mt-44 py-16 sm:py-24"
      aria-labelledby="new-arrivals-title"
    >
      <div className="mx-auto max-w-[1440px] px-6 sm:px-10 lg:px-16">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-6 sm:mb-12">
          <div>
            <h2
              id="new-arrivals-title"
              data-reveal
              className="font-heading text-4xl font-normal tracking-[-0.035em] sm:text-5xl"
            >
              Lo nuevo, lo tuyo.
            </h2>
            <p data-reveal className="text-muted-foreground mt-4 text-base">
              Un nuevo favorito te está esperando.
            </p>
          </div>
          <Link
            data-reveal
            href="/catalog?sort=newest"
            className="editorial-link inline-flex min-h-11 items-center gap-4 text-sm font-medium"
          >
            Ver novedades <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {products.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-6 lg:grid-cols-4">
            {products.map((product, index) => (
              <div
                data-reveal
                key={product.id}
                style={{ "--reveal-delay": `${index * 65}ms` } as CSSProperties}
              >
                {product.primaryImageUrl ? (
                  <ProductCard product={product} />
                ) : (
                  <Link
                    href={`/product/${product.slug}`}
                    className="group bg-muted hover:bg-secondary flex min-h-28 items-center justify-between gap-4 px-5 py-6 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-base leading-6 font-medium">{product.name}</p>
                      {product.priceDisplay && (
                        <p className="mt-2 text-sm tabular-nums">{product.priceDisplay}</p>
                      )}
                    </div>
                    <ArrowUpRight
                      className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-muted px-6 py-12 sm:px-10">
            <p className="font-heading text-2xl">La próxima selección está en camino.</p>
            <p className="text-muted-foreground mt-3 text-base">
              Volvé pronto para descubrir las novedades de CHAIOBOUTIQUE.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
