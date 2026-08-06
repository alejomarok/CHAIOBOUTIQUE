import { ShoppingBag } from "lucide-react";
import Link from "next/link";

import { getCart } from "@/modules/cart/service";

// Server Component — reads the cart read-only (getCart never creates a row
// or writes a cookie; see modules/cart/identity.ts), so a first-time
// visitor with no cart yet renders a plain, badge-less icon instead of
// silently provisioning one just by loading a page.
export async function CartIconLink() {
  const cart = await getCart();

  return (
    <Link
      href="/cart"
      className="relative flex size-9 items-center justify-center rounded-lg hover:bg-accent"
      aria-label={cart.itemCount > 0 ? `Carrito, ${cart.itemCount} artículos` : "Carrito"}
    >
      <ShoppingBag className="size-5" />
      {cart.itemCount > 0 && (
        <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
          {cart.itemCount > 99 ? "99+" : cart.itemCount}
        </span>
      )}
    </Link>
  );
}
