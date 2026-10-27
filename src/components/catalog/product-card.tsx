import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import type { PublicProductCardDTO } from "@/modules/products/public-queries";

export function ProductCard({ product }: { product: PublicProductCardDTO }) {
  return (
    <Link href={`/product/${product.slug}`} className="group flex min-w-0 flex-col">
      <div className="relative aspect-[3/4] overflow-hidden bg-[#eeede7]">
        <ProductImage
          src={product.primaryImageUrl}
          alt={product.name}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] group-focus-visible:scale-[1.04]"
        />
        {product.compareAtPriceDisplay && (
          <span className="absolute top-3 left-3 bg-[#34483d] px-3 py-1.5 text-xs font-medium text-white">
            Precio especial
          </span>
        )}
        <span className="text-foreground absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-between bg-white/95 px-4 py-3 text-sm opacity-0 transition-[transform,opacity] duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
          Ver prenda <ArrowUpRight className="size-4" aria-hidden="true" />
        </span>
      </div>
      <div className="pt-4">
        <p className="text-foreground group-hover:text-primary line-clamp-2 text-[15px] font-normal transition-colors">
          {product.name}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
          {product.priceDisplay && <p className="text-sm font-medium">{product.priceDisplay}</p>}
          {product.compareAtPriceDisplay && (
            <p className="text-muted-foreground text-xs line-through">
              {product.compareAtPriceDisplay}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
