import { CartView } from "@/components/cart/cart-view";
import { getCart } from "@/modules/cart/service";

export const metadata = { title: "Carrito" };

export default async function CartPage() {
  const cart = await getCart();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <h1 className="font-heading mb-8 text-3xl font-semibold sm:text-4xl">Carrito</h1>
      <CartView initialCart={cart} />
    </div>
  );
}
