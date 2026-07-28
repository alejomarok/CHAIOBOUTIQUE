"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublicVariantDTO } from "@/modules/products/public-queries";

const STOCK_LABELS_ES: Record<PublicVariantDTO["stockStatus"], string> = {
  IN_STOCK: "En stock",
  LOW_STOCK: "Últimas unidades",
  OUT_OF_STOCK: "Sin stock",
};

export function ProductVariantSelector({ variants }: { variants: PublicVariantDTO[] }) {
  const sizes = useMemo(
    () => [...new Set(variants.map((v) => v.sizeName).filter((s): s is string => s !== null))],
    [variants],
  );
  const colors = useMemo(
    () => [...new Set(variants.map((v) => v.colorName).filter((c): c is string => c !== null))],
    [variants],
  );

  const firstInStock = variants.find((v) => v.stockStatus !== "OUT_OF_STOCK") ?? variants[0];
  const [selectedSize, setSelectedSize] = useState<string | null>(firstInStock?.sizeName ?? null);
  const [selectedColor, setSelectedColor] = useState<string | null>(
    firstInStock?.colorName ?? null,
  );

  const selectedVariant =
    variants.find((v) => v.sizeName === selectedSize && v.colorName === selectedColor) ??
    firstInStock;

  if (!selectedVariant) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-semibold">{selectedVariant.priceDisplay}</p>
        {selectedVariant.compareAtPriceDisplay && (
          <p className="text-muted-foreground line-through">
            {selectedVariant.compareAtPriceDisplay}
          </p>
        )}
      </div>

      {sizes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Talle</p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => (
              <Button
                key={size}
                type="button"
                size="sm"
                variant={size === selectedSize ? "default" : "outline"}
                onClick={() => setSelectedSize(size)}
              >
                {size}
              </Button>
            ))}
          </div>
        </div>
      )}

      {colors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Color</p>
          <div className="flex flex-wrap gap-2">
            {colors.map((color) => (
              <Button
                key={color}
                type="button"
                size="sm"
                variant={color === selectedColor ? "default" : "outline"}
                onClick={() => setSelectedColor(color)}
              >
                {color}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Badge variant={selectedVariant.stockStatus === "OUT_OF_STOCK" ? "outline" : "secondary"}>
        {STOCK_LABELS_ES[selectedVariant.stockStatus]}
      </Badge>
    </div>
  );
}
