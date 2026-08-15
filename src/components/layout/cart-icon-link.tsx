import { ShoppingBag } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getCart } from "@/modules/cart/service";

// Server Component — reads the cart read-only (getCart never creates a row
// or writes a cookie; see modules/cart/identity.ts), so a first-time
// visitor with no cart yet renders a plain, badge-less icon instead of
// silently provisioning one just by loading a page. Built on the shared
// Button primitive (size="icon", h-8) so it lines up exactly with the
// h-8 text buttons next to it in the header — same visual language, not a
// hand-rolled size.
export async function CartIconLink() {
  const cart = await getCart();

  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link
        href="/cart"
        aria-label={cart.itemCount > 0 ? `Carrito, ${cart.itemCount} artículos` : "Carrito"}
      >
        <ShoppingBag className="size-5" />
        {cart.itemCount > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
            {cart.itemCount > 99 ? "99+" : cart.itemCount}
          </span>
        )}
      </Link>
    </Button>
  );
}
