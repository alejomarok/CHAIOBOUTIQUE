import { redirect } from "next/navigation";

import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { minorUnitsToDisplay } from "@/lib/money";
import { getCurrentUser } from "@/modules/auth";
import { getCart } from "@/modules/cart/service";
import { getCustomerByLinkedUserId, getCustomerById } from "@/modules/customers/customer";
import { listAvailableDeliveryMethods } from "@/modules/orders/order";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const cart = await getCart();
  // Nothing to check out — send them back rather than showing an empty
  // wizard. A cart with non-blocking issues (e.g. a price change) is still
  // allowed through: submission re-validates everything server-side and
  // gives specific, actionable feedback at that point (see
  // modules/orders/order-core.ts's createOrderFromCart).
  if (cart.items.length === 0) redirect("/cart");

  const user = await getCurrentUser();
  const isCustomer = user?.roles.includes("CUSTOMER") ?? false;

  let contactPrefill: { firstName: string; lastName: string; email: string; phone: string } | null = null;
  let savedAddresses: {
    id: string;
    label: string | null;
    street: string;
    number: string | null;
    floor: string | null;
    apartment: string | null;
    postalCode: string | null;
    city: string;
    province: string | null;
    isDefaultShipping: boolean;
  }[] = [];

  if (isCustomer && user) {
    const customer = await getCustomerByLinkedUserId(user.id);
    if (customer) {
      const full = await getCustomerById(customer.id);
      contactPrefill = {
        firstName: customer.firstName ?? "",
        lastName: customer.lastName ?? "",
        email: customer.email ?? user.email,
        phone: customer.phone ?? "",
      };
      savedAddresses = (full?.addresses ?? []).map((address) => ({
        id: address.id,
        label: address.label,
        street: address.street,
        number: address.number,
        floor: address.floor,
        apartment: address.apartment,
        postalCode: address.postalCode,
        city: address.city,
        province: address.province,
        isDefaultShipping: address.isDefaultShipping,
      }));
    }
  }

  const deliveryMethodOptions = await listAvailableDeliveryMethods();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <h1 className="font-heading mb-8 text-3xl font-semibold sm:text-4xl">Checkout</h1>
      <CheckoutFlow
        cart={cart}
        isAuthenticated={isCustomer}
        contactPrefill={contactPrefill}
        savedAddresses={savedAddresses}
        deliveryMethods={deliveryMethodOptions.map((option) => ({
          method: option.method,
          label: option.label,
          feeAmount: option.feeAmount.toString(),
          feeDisplay: option.feeAmount > 0n ? minorUnitsToDisplay(option.feeAmount) : null,
          pickupInstructions: option.pickupInstructions,
        }))}
      />
    </div>
  );
}
