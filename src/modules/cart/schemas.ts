import { z } from "zod";

import { MAX_ITEM_QUANTITY } from "./constants";

// Bounds mirror modules/cart/service.ts's own runtime checks — Zod is the
// first, cheap rejection (malformed shape, wrong type, out-of-range int);
// the service layer's checks are the actual, unbypassable enforcement
// (Server Actions are the only way in, but never trust a single layer).
export const addItemSchema = z.object({
  productId: z.string().min(1),
  productVariantId: z.string().min(1),
  quantity: z.number().int().positive().max(MAX_ITEM_QUANTITY),
});
export type AddItemInput = z.infer<typeof addItemSchema>;

export const setItemQuantitySchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive().max(MAX_ITEM_QUANTITY),
});
export type SetItemQuantityInput = z.infer<typeof setItemQuantitySchema>;

export const removeItemSchema = z.object({
  itemId: z.string().min(1),
});
export type RemoveItemInput = z.infer<typeof removeItemSchema>;
