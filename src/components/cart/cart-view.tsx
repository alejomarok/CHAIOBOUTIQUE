"use client";

import { Minus, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  clearCartAction,
  removeItemAction,
  setItemQuantityAction,
} from "@/app/(public)/cart/actions";
import { ProductImage } from "@/components/catalog/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MAX_ITEM_QUANTITY } from "@/modules/cart/constants";
// Type-only: the real module (@/modules/cart/service) is "server-only" and
// must never be pulled into a client bundle. A `import type` is erased at
// compile time, but a runtime VALUE import (like MAX_ITEM_QUANTITY above)
// is not — that one has to come from the dependency-free constants module
// instead, or bundlers drag Prisma/pg/nodemailer into the browser build.
import type { CartDTO, CartItemDTO } from "@/modules/cart/service";

const ISSUE_VARIANT: Record<CartItemDTO["issues"][number]["code"], "destructive" | "outline"> = {
  PRODUCT_INACTIVE: "destructive",
  VARIANT_INACTIVE: "destructive",
  VARIANT_REMOVED: "destructive",
  INSUFFICIENT_STOCK: "destructive",
  PRICE_CHANGED: "outline",
};

export function CartView({ initialCart }: { initialCart: CartDTO }) {
  const router = useRouter();
  const [cart, setCart] = useState(initialCart);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set());
  const [isClearing, setIsClearing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  function withItemPending<T>(itemId: string, run: () => Promise<T>): Promise<T> {
    setPendingItemIds((prev) => new Set(prev).add(itemId));
    return run().finally(() => {
      setPendingItemIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    });
  }

  async function handleQuantityChange(item: CartItemDTO, nextQuantity: number) {
    if (nextQuantity < 1 || nextQuantity > MAX_ITEM_QUANTITY) return;
    if (pendingItemIds.has(item.id)) return; // guards against duplicate/rapid clicks
    try {
      const updated = await withItemPending(item.id, () =>
        setItemQuantityAction({ itemId: item.id, quantity: nextQuantity }),
      );
      setCart(updated);
      router.refresh(); // keeps the header badge in sync with this page
    } catch {
      toast.error("No pudimos actualizar la cantidad. Intentá de nuevo.");
    }
  }

  async function handleRemove(item: CartItemDTO) {
    if (pendingItemIds.has(item.id)) return;
    try {
      const updated = await withItemPending(item.id, () => removeItemAction({ itemId: item.id }));
      setCart(updated);
      toast.success("Artículo eliminado.");
      router.refresh();
    } catch {
      toast.error("No pudimos eliminar el artículo. Intentá de nuevo.");
    }
  }

  async function handleClearCart() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    if (isClearing) return;
    setIsClearing(true);
    try {
      const updated = await clearCartAction();
      setCart(updated);
      toast.success("Carrito vaciado.");
      router.refresh();
    } catch {
      toast.error("No pudimos vaciar el carrito. Intentá de nuevo.");
    } finally {
      setIsClearing(false);
    }
  }

  if (cart.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <div className="bg-blush flex size-16 items-center justify-center rounded-full">
          <ShoppingBag className="text-accent-cyan size-7" />
        </div>
        <div>
          <p className="font-heading text-xl font-semibold">Tu carrito está vacío.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Todavía no agregaste ningún producto.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/catalog">Explorar productos</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_320px]">
      <ul className="flex flex-col gap-4">
        {cart.items.map((item) => {
          const isItemPending = pendingItemIds.has(item.id);
          return (
            <li
              key={item.id}
              className="ring-border/60 flex gap-4 rounded-2xl p-4 ring-1 sm:items-center"
            >
              <div className="bg-muted relative size-20 shrink-0 overflow-hidden rounded-xl sm:size-24">
                <ProductImage
                  src={item.imageUrl}
                  alt={item.productName}
                  sizes="96px"
                  className="object-cover"
                />
              </div>

              <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/product/${item.productSlug}`}
                      className="font-medium hover:underline"
                    >
                      {item.productName}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {[item.sizeName, item.colorName].filter(Boolean).join(" · ") || "Talle único"}
                    </p>
                  </div>
                  <p className="text-sm font-medium whitespace-nowrap">{item.lineTotalDisplay}</p>
                </div>

                <p className="text-muted-foreground text-xs">{item.unitPriceDisplay} c/u</p>

                {item.issues.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.issues.map((issue) => (
                      <Badge key={issue.code} variant={ISSUE_VARIANT[issue.code]} className="text-xs">
                        {issue.message}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="mt-1 flex items-center gap-3">
                  <div className="border-input flex items-center rounded-lg border">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isItemPending || item.quantity <= 1}
                      onClick={() => handleQuantityChange(item, item.quantity - 1)}
                      aria-label="Restar cantidad"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-8 text-center text-sm tabular-nums">{item.quantity}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isItemPending || item.quantity >= MAX_ITEM_QUANTITY}
                      onClick={() => handleQuantityChange(item, item.quantity + 1)}
                      aria-label="Sumar cantidad"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isItemPending}
                    onClick={() => handleRemove(item)}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <aside className="bg-blush/50 flex h-fit flex-col gap-4 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <p className="font-medium">Subtotal</p>
          <p className="font-heading text-xl font-semibold">{cart.subtotalDisplay}</p>
        </div>
        {cart.hasIssues && (
          <p className="text-muted-foreground text-xs">
            Algunos artículos tienen problemas — revisalos arriba antes de continuar.
          </p>
        )}
        {/* Not yet functional — checkout lands in a later phase. Shown
            disabled so the next step is visible rather than hidden. */}
        <Button type="button" disabled className="w-full">
          Continuar a la compra (próximamente)
        </Button>
        <p className="text-muted-foreground text-xs">
          El stock se confirma definitivamente al finalizar la compra.
        </p>
        {confirmingClear ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="flex-1"
              disabled={isClearing}
              onClick={handleClearCart}
            >
              Confirmar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={isClearing}
              onClick={() => setConfirmingClear(false)}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingClear(true)}>
            Vaciar carrito
          </Button>
        )}
      </aside>
    </div>
  );
}
