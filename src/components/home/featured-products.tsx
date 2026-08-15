import Link from "next/link";

import { ProductCard } from "@/components/catalog/product-card";
import { Button } from "@/components/ui/button";
import { listPublicProducts } from "@/modules/products/public-queries";

const FEATURED_COUNT = 8;

export async function FeaturedProducts() {
  const products = await listPublicProducts({ take: FEATURED_COUNT, sort: "newest" });

  // Real data only — an empty catalog means no section, never placeholder
  // product cards.
  if (products.length === 0) return null;

  return (
    <section className="bg-muted/50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-2xl font-semibold sm:text-3xl">Novedades</h2>
            <p className="text-muted-foreground text-sm sm:text-base">
              Descubrí los últimos ingresos de CHAIOBOUTIQUE.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/catalog?sort=newest">Ver todo</Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}
