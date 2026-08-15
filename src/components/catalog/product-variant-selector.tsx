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
  IN_STOCK: "Stock disponible",
  LOW_STOCK: "Últimas unidades",
  OUT_OF_STOCK: "Sin stock",
};

const STOCK_BADGE_CLASS: Record<PublicVariantDTO["stockStatus"], string> = {
  IN_STOCK: "bg-success/15 text-success",
  LOW_STOCK: "bg-accent-orange/20 text-foreground",
  OUT_OF_STOCK: "bg-muted text-muted-foreground",
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

  const needsSize = sizes.length > 0 && !selectedSizeId;
  const needsColor = colors.length > 0 && !selectedColorId;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline gap-2">
        <p className="font-heading text-3xl font-semibold">
          {selectedVariant?.priceDisplay ?? firstInStock?.priceDisplay}
        </p>
        {(selectedVariant?.compareAtPriceDisplay ?? firstInStock?.compareAtPriceDisplay) && (
          <p className="text-muted-foreground line-through">
            {selectedVariant?.compareAtPriceDisplay ?? firstInStock?.compareAtPriceDisplay}
          </p>
        )}
      </div>

      {sizes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Talle</p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const isSelected = size.id === selectedSizeId;
              return (
                <Button
                  key={size.id}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  className={isSelected ? "ring-primary/30 ring-2 ring-offset-1" : ""}
                  disabled={!isSizeAvailable(variants, size.id, selectedColorId)}
                  onClick={() => setSelectedSizeId(size.id)}
                >
                  {size.name}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {colors.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Color</p>
          <div className="flex flex-wrap gap-2">
            {colors.map((color) => {
              const isSelected = color.id === selectedColorId;
              return (
                <Button
                  key={color.id}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  className={isSelected ? "ring-primary/30 ring-2 ring-offset-1" : ""}
                  disabled={!isColorAvailable(variants, color.id, selectedSizeId)}
                  onClick={() => setSelectedColorId(color.id)}
                >
                  {color.name}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {needsSize || needsColor ? (
        <p className="text-muted-foreground text-sm">
          {needsSize && needsColor
            ? "Seleccioná un talle y un color."
            : needsSize
              ? "Seleccioná un talle."
              : "Seleccioná un color."}
        </p>
      ) : selectedVariant ? (
        <Badge className={`w-fit border-none ${STOCK_BADGE_CLASS[selectedVariant.stockStatus]}`}>
          {STOCK_LABELS_ES[selectedVariant.stockStatus]}
        </Badge>
      ) : (
        <p className="text-muted-foreground text-sm">
          Esa combinación no está disponible. Probá con otro talle o color.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="border-input flex w-fit items-center rounded-lg border">
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
        <Button
          type="button"
          size="lg"
          className="flex-1"
          disabled={!canAddToCart}
          onClick={handleAddToCart}
        >
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
