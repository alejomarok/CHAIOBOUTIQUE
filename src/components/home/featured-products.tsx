import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { ProductCard } from "@/components/catalog/product-card";
import { listPublicProducts } from "@/modules/products/public-queries";

const FEATURED_COUNT = 8;

export async function FeaturedProducts() {
  const products = await listPublicProducts({ take: FEATURED_COUNT, sort: "newest" });

  if (products.length === 0) return null;

  return (
    <section className="border-y border-[#eee3dc] bg-[#fbf4ef] py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[1380px] px-5 sm:px-8 lg:px-10">
        <div className="mb-9 flex flex-col gap-5 sm:mb-11 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a37c6c]">
              Recién llegados
            </p>
            <h2 className="mt-3 font-heading text-3xl font-medium tracking-[-0.025em] text-[#342d29] sm:text-4xl">
              Novedades
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#80756f] sm:text-base">
              Una selección de los últimos ingresos de CHAIOBOUTIQUE.
            </p>
          </div>

          <Link
            href="/catalog?sort=newest"
            className="group inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#4f4540] transition hover:text-[#159aa0]"
          >
            Ver toda la colección
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 lg:gap-y-10">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}
