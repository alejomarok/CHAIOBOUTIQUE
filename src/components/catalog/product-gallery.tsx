"use client";

import { useState } from "react";

import { ProductImage } from "@/components/catalog/product-image";
import type { PublicProductImageDTO } from "@/modules/products/public-queries";

export function ProductGallery({
  images,
  productName,
}: {
  images: PublicProductImageDTO[];
  productName: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = images[selectedIndex] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted ring-border/60 relative aspect-[4/5] overflow-hidden rounded-2xl ring-1">
        <ProductImage
          src={selected?.url ?? null}
          alt={selected?.altText ?? productName}
          sizes="(min-width: 768px) 50vw, 100vw"
          className="object-cover"
          priority
        />
      </div>
      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              onClick={() => setSelectedIndex(index)}
              aria-label={`Ver imagen ${index + 1} de ${productName}`}
              aria-current={index === selectedIndex}
              className={`bg-muted relative aspect-square overflow-hidden rounded-lg ring-1 transition-all ${
                index === selectedIndex
                  ? "ring-primary ring-2"
                  : "ring-border/60 opacity-80 hover:opacity-100"
              }`}
            >
              <ProductImage
                src={image.url}
                alt={image.altText ?? productName}
                sizes="80px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
