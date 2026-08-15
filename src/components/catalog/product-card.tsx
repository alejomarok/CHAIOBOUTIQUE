import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import type { PublicProductCardDTO } from "@/modules/products/public-queries";

export function ProductCard({ product }: { product: PublicProductCardDTO }) {
  return (
    <Link href={`/product/${product.slug}`} className="group flex flex-col gap-3">
      <div className="bg-muted ring-border/60 relative aspect-[3/4] overflow-hidden rounded-2xl ring-1">
        <ProductImage
          src={product.primaryImageUrl}
          alt={product.name}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        {product.compareAtPriceDisplay && (
          <span className="bg-accent-pink text-foreground absolute top-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase">
            Oferta
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground line-clamp-1 text-sm font-medium">{product.name}</p>
        <div className="flex items-baseline gap-2">
          {product.priceDisplay && (
            <p className="text-foreground text-sm font-semibold">{product.priceDisplay}</p>
          )}
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
