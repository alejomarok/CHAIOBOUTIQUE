"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/modules/auth";
import { findExistingCartRow, findCheckoutRetryCartRow } from "@/modules/cart/service";
import { processEmailOutbox } from "@/modules/email/outbox-core";
import { createRateLimiter } from "@/lib/rate-limit";
import { requestIp } from "@/lib/request-ip";
import { getCustomerByLinkedUserId } from "@/modules/customers/customer";
import { createOrderFromCart } from "@/modules/orders/order";

// Every field below is re-validated/re-resolved server-side by
// createOrderFromCart itself (price, stock, purchasability, delivery-fee
// amount) — this schema only shapes the request, it is never trusted as
// authoritative. cartId/userId/customerId are NEVER accepted from the
// client at all — resolved here, server-side, from the current session/
// cookie identity, exactly like every other cart mutation in this codebase.

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "Ingresá tu nombre.").max(100),
  lastName: z.string().trim().min(1, "Ingresá tu apellido.").max(100),
  email: z.string().trim().min(1, "Ingresá tu email.").email("Ingresá un email válido.").max(254),
  phone: z.string().max(40).optional(),
});

const addressSchema = z.object({
  label: z.string().max(100).optional(),
  street: z.string().trim().min(1, "Ingresá la calle.").max(200),
  number: z.string().max(30).optional(),
  floor: z.string().max(30).optional(),
  apartment: z.string().max(30).optional(),
  postalCode: z.string().max(20).optional(),
  city: z.string().trim().min(1, "Ingresá la ciudad.").max(120),
  province: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

const checkoutSchema = z.object({
  termsAccepted: z.literal(true, "Aceptá los términos y la política de privacidad para continuar."),
  contact: contactSchema,
  deliveryMethod: z.enum(["PICKUP", "HOME_DELIVERY"]),
  existingAddressId: z.string().max(100).optional(),
  newAddress: addressSchema.optional(),
  notes: z.string().max(2000).optional(),
  // Client-generated at checkout-page-mount time, resubmitted unchanged on
  // retry — see modules/orders/order-core.ts's createOrderFromCart for how
  // this protects against a double-click/network retry creating two Orders.
  idempotencyKey: z.string().min(1).max(200),
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
      "DeliveryCoverageError",
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
const checkoutLimiter = createRateLimiter(30, 60 * 60 * 1000);

export async function submitCheckoutAction(
  input: z.infer<typeof checkoutSchema>,
): Promise<SubmitCheckoutResult> {
  const data = checkoutSchema.parse(input);
  if (!(await checkoutLimiter.check(`checkout:${await requestIp()}`)).success)
    throw new Error("Recibimos demasiados intentos. Esperá unos minutos e intentá nuevamente.");

  const user = await getCurrentUser();
  const isCustomer = user?.roles.includes("CUSTOMER") ?? false;

  const cart =
    (await findCheckoutRetryCartRow(data.idempotencyKey)) ?? (await findExistingCartRow());
  if (!cart) throw new Error("Tu carrito está vacío.");

  let customerId: string | null = null;
  if (isCustomer && user) {
    const customer = await getCustomerByLinkedUserId(user.id);
    customerId = customer?.id ?? null;
  }

  try {
    const result = await createOrderFromCart({
      cartId: cart.id,
      policyAccepted: true,
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
    after(async () => {
      await processEmailOutbox(2);
    });
    return { orderCode: result.order.code, accessToken: result.rawAccessToken };
  } catch (error) {
    throw new Error(toFriendlyMessage(error));
  }
}
