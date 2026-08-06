"use client";

import { Minus, Plus } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { addItemAction } from "@/app/(public)/cart/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublicVariantDTO } from "@/modules/products/public-queries";
import {
  findSelectedVariant,
  isColorAvailable,
  isSizeAvailable,
  listColorOptions,
  listSizeOptions,
  pickDefaultVariant,
} from "@/modules/products/variant-selection";

const STOCK_LABELS_ES: Record<PublicVariantDTO["stockStatus"], string> = {
  IN_STOCK: "En stock",
  LOW_STOCK: "Últimas unidades",
  OUT_OF_STOCK: "Sin stock",
};

export function ProductVariantSelector({
  productId,
  variants,
}: {
  productId: string;
  variants: PublicVariantDTO[];
}) {
  const [isPending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(1);

  const sizes = useMemo(() => listSizeOptions(variants), [variants]);
  const colors = useMemo(() => listColorOptions(variants), [variants]);

  const firstInStock = useMemo(() => pickDefaultVariant(variants), [variants]);
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(
    firstInStock?.sizeOptionId ?? null,
  );
  const [selectedColorId, setSelectedColorId] = useState<string | null>(
    firstInStock?.colorId ?? null,
  );

  // Required behavior: "prevent adding a product until a concrete valid
  // variant has been selected" — undefined here means the current
  // size+color combination doesn't correspond to any real variant (e.g.
  // both axes exist but this specific pairing was never stocked).
  const selectedVariant = findSelectedVariant(variants, selectedSizeId, selectedColorId);

  const outOfStock = selectedVariant?.stockStatus === "OUT_OF_STOCK";
  const canAddToCart = Boolean(selectedVariant) && !outOfStock && !isPending;

  function handleAddToCart() {
    if (!selectedVariant) return;
    startTransition(async () => {
      try {
        await addItemAction({
          productId,
          productVariantId: selectedVariant.id,
          quantity,
        });
        toast.success("Se agregó al carrito.");
        setQuantity(1);
      } catch {
        toast.error("No pudimos agregar el producto al carrito. Intentá de nuevo.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-semibold">
          {selectedVariant?.priceDisplay ?? firstInStock?.priceDisplay}
        </p>
        {(selectedVariant?.compareAtPriceDisplay ?? firstInStock?.compareAtPriceDisplay) && (
          <p className="text-muted-foreground line-through">
            {selectedVariant?.compareAtPriceDisplay ?? firstInStock?.compareAtPriceDisplay}
          </p>
        )}
      </div>

      {sizes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Talle</p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => (
              <Button
                key={size.id}
                type="button"
                size="sm"
                variant={size.id === selectedSizeId ? "default" : "outline"}
                disabled={!isSizeAvailable(variants, size.id, selectedColorId)}
                onClick={() => setSelectedSizeId(size.id)}
              >
                {size.name}
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
                key={color.id}
                type="button"
                size="sm"
                variant={color.id === selectedColorId ? "default" : "outline"}
                disabled={!isColorAvailable(variants, color.id, selectedSizeId)}
                onClick={() => setSelectedColorId(color.id)}
              >
                {color.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {selectedVariant ? (
        <div className="flex flex-col gap-1 text-xs">
          <p className="text-muted-foreground">SKU: {selectedVariant.sku}</p>
          <Badge
            variant={selectedVariant.stockStatus === "OUT_OF_STOCK" ? "outline" : "secondary"}
            className="w-fit"
          >
            {STOCK_LABELS_ES[selectedVariant.stockStatus]}
          </Badge>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Seleccioná una combinación disponible para continuar.
        </p>
      )}

      <div className="flex items-center gap-3">
        <div className="border-input flex items-center rounded-lg border">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={quantity <= 1 || isPending}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            aria-label="Restar cantidad"
          >
            <Minus className="size-4" />
          </Button>
          <span className="w-8 text-center text-sm tabular-nums">{quantity}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={isPending}
            onClick={() => setQuantity((q) => q + 1)}
            aria-label="Sumar cantidad"
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <Button type="button" className="flex-1" disabled={!canAddToCart} onClick={handleAddToCart}>
          {isPending ? "Agregando…" : outOfStock ? "Sin stock" : "Agregar al carrito"}
        </Button>
      </div>
      {/* Required behavior: stock is checked again at checkout — being in
          the cart never reserves it. */}
      <p className="text-muted-foreground text-xs">
        El stock se confirma definitivamente al finalizar la compra.
      </p>
    </div>
  );
}
