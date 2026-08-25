"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/modules/auth";
import { findExistingCartRow } from "@/modules/cart/service";
import { getCustomerByLinkedUserId } from "@/modules/customers/customer";
import { createOrderFromCart } from "@/modules/orders/order";

// Every field below is re-validated/re-resolved server-side by
// createOrderFromCart itself (price, stock, purchasability, delivery-fee
// amount) — this schema only shapes the request, it is never trusted as
// authoritative. cartId/userId/customerId are NEVER accepted from the
// client at all — resolved here, server-side, from the current session/
// cookie identity, exactly like every other cart mutation in this codebase.

const contactSchema = z.object({
  firstName: z.string().min(1, "Ingresá tu nombre."),
  lastName: z.string().min(1, "Ingresá tu apellido."),
  email: z.string().min(1, "Ingresá tu email.").email("Ingresá un email válido."),
  phone: z.string().optional(),
});

const addressSchema = z.object({
  label: z.string().optional(),
  street: z.string().min(1, "Ingresá la calle."),
  number: z.string().optional(),
  floor: z.string().optional(),
  apartment: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().min(1, "Ingresá la ciudad."),
  province: z.string().optional(),
  notes: z.string().optional(),
});

const checkoutSchema = z.object({
  contact: contactSchema,
  deliveryMethod: z.enum(["PICKUP", "HOME_DELIVERY"]),
  existingAddressId: z.string().optional(),
  newAddress: addressSchema.optional(),
  notes: z.string().optional(),
  // Client-generated at checkout-page-mount time, resubmitted unchanged on
  // retry — see modules/orders/order-core.ts's createOrderFromCart for how
  // this protects against a double-click/network retry creating two Orders.
  idempotencyKey: z.string().min(1),
});

// Friendly Spanish translation for the service layer's typed errors — never
// a raw internal error string reaches the client. PriceChangedError/
// InsufficientCheckoutStockError's own .message is ALREADY the final,
// specific Spanish text (see modules/orders/order-core.ts) — passed through
// verbatim, never re-wrapped.
function toFriendlyMessage(error: unknown): string {
  if (error instanceof Error) {
    const knownErrors = [
      "EmptyCartError",
      "CartHasBlockingIssuesError",
      "PriceChangedError",
      "InsufficientCheckoutStockError",
      "NoDefaultWarehouseError",
      "DeliveryMethodNotAvailableError",
      "MissingDeliveryAddressError",
      "AddressNotFoundError",
      "InvalidContactInfoError",
    ];
    if (knownErrors.includes(error.name)) return error.message;
  }
  return "No pudimos procesar tu pedido. Intentá de nuevo.";
}

export interface SubmitCheckoutResult {
  orderCode: string;
  accessToken: string;
}

export async function submitCheckoutAction(
  input: z.infer<typeof checkoutSchema>,
): Promise<SubmitCheckoutResult> {
  const data = checkoutSchema.parse(input);

  const user = await getCurrentUser();
  const isCustomer = user?.roles.includes("CUSTOMER") ?? false;

  const cart = await findExistingCartRow();
  if (!cart) throw new Error("Tu carrito está vacío.");

  let customerId: string | null = null;
  if (isCustomer && user) {
    const customer = await getCustomerByLinkedUserId(user.id);
    customerId = customer?.id ?? null;
  }

  try {
    const result = await createOrderFromCart({
      cartId: cart.id,
      userId: isCustomer && user ? user.id : null,
      customerId,
      contact: data.contact,
      deliveryMethod: data.deliveryMethod,
      existingAddressId: data.existingAddressId || null,
      newAddress: data.newAddress || null,
      notes: data.notes || null,
      idempotencyKey: data.idempotencyKey,
    });
    revalidatePath("/cart");
    return { orderCode: result.order.code, accessToken: result.rawAccessToken };
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
}
