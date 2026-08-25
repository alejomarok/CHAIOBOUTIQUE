import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import type { PublicProductCardDTO } from "@/modules/products/public-queries";

export function ProductCard({ product }: { product: PublicProductCardDTO }) {
  return (
    <Link href={`/product/${product.slug}`} className="group flex min-w-0 flex-col">
      <div className="relative aspect-[3/4] overflow-hidden rounded-[1.35rem] bg-[#f1e8e2]">
        <ProductImage
          src={product.primaryImageUrl}
          alt={product.name}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.045]"
        />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {product.compareAtPriceDisplay && (
          <span className="absolute left-3 top-3 rounded-full bg-[#e9989d] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm">
            Oferta
          </span>
        )}

        <span className="absolute bottom-3 right-3 flex size-9 translate-y-2 items-center justify-center rounded-full bg-white/90 text-[#3f3733] opacity-0 shadow-sm backdrop-blur-sm transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </span>
      </div>

      <div className="px-0.5 pt-3.5">
        <p className="line-clamp-1 text-sm font-medium text-[#403733] transition-colors group-hover:text-[#159aa0]">
          {product.name}
        </p>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {product.priceDisplay && (
            <p className="text-sm font-semibold text-[#332c29]">{product.priceDisplay}</p>
          )}
          {product.compareAtPriceDisplay && (
            <p className="text-xs text-[#988c86] line-through">{product.compareAtPriceDisplay}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
