import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import type { PublicProductCardDTO } from "@/modules/products/public-queries";

export function ProductCard({ product }: { product: PublicProductCardDTO }) {
  return (
    <Link href={`/product/${product.slug}`} className="group flex flex-col gap-2">
      <div className="bg-muted relative aspect-[3/4] overflow-hidden rounded-xl">
        <ProductImage
          src={product.primaryImageUrl}
          alt={product.name}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <div>
        <p className="text-sm font-medium">{product.name}</p>
        <div className="flex items-baseline gap-2">
          {product.priceDisplay && <p className="text-sm">{product.priceDisplay}</p>}
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
