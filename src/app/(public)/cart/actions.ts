"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { cartMutationRateLimiter } from "@/lib/rate-limiters";
import { buildCartMutationRateLimitKey } from "@/modules/cart/rate-limit";
import { addItemSchema, removeItemSchema, setItemQuantitySchema } from "@/modules/cart/schemas";
import * as cartService from "@/modules/cart/service";

// Every mutation below re-derives cart/user identity entirely server-side
// (see modules/cart/identity.ts) — none of these ever accepts a userId,
// cartId, itemId-ownership claim, or price from the client beyond what's
// validated here. `itemId`/`productVariantId` are opaque references the
// service layer re-resolves and re-validates itself (ownership, current
// price, current stock) on every call; nothing about them is trusted at
// face value.

async function checkCartRateLimit(): Promise<void> {
  const key = await buildCartMutationRateLimitKey();
  const result = await cartMutationRateLimiter.check(key);
  if (!result.success) {
    throw new Error("Demasiadas acciones en el carrito. Esperá un momento e intentá de nuevo.");
  }
}

export async function getCartAction(): Promise<cartService.CartDTO> {
  return cartService.getCart();
}

export async function addItemAction(
  input: z.input<typeof addItemSchema>,
): Promise<cartService.CartDTO> {
  await checkCartRateLimit();
  const data = addItemSchema.parse(input);
  const cart = await cartService.addItem(data);
  revalidatePath("/cart");
  return cart;
}

export async function setItemQuantityAction(
  input: z.input<typeof setItemQuantitySchema>,
): Promise<cartService.CartDTO> {
  await checkCartRateLimit();
  const data = setItemQuantitySchema.parse(input);
  const cart = await cartService.setItemQuantity(data.itemId, data.quantity);
  revalidatePath("/cart");
  return cart;
}

export async function removeItemAction(
  input: z.input<typeof removeItemSchema>,
): Promise<cartService.CartDTO> {
  await checkCartRateLimit();
  const data = removeItemSchema.parse(input);
  const cart = await cartService.removeItem(data.itemId);
  revalidatePath("/cart");
  return cart;
}

export async function clearCartAction(): Promise<cartService.CartDTO> {
  await checkCartRateLimit();
  const cart = await cartService.clearCart();
  revalidatePath("/cart");
  return cart;
}

// Called right after a successful CUSTOMER sign-in or registration — see
// components/auth/login-form.tsx and register-form.tsx. Not rate-limited
// like the mutations above: it only ever runs once per real sign-in event
// (driven by the auth flow, not repeatable button-mashing), and re-running
// it is already a safe no-op by construction (see the merge policy doc in
// modules/cart/service.ts).
export async function mergeAnonymousCartAction(): Promise<cartService.CartDTO> {
  const cart = await cartService.mergeAnonymousCartIntoCustomerCart();
  revalidatePath("/cart");
  return cart;
}
