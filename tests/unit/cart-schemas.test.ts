import { describe, expect, it } from "vitest";

import { MAX_ITEM_QUANTITY } from "@/modules/cart/constants";
import { addItemSchema, removeItemSchema, setItemQuantitySchema } from "@/modules/cart/schemas";

describe("addItemSchema", () => {
  it("accepts a valid payload", () => {
    const result = addItemSchema.safeParse({
      productId: "prod_1",
      productVariantId: "var_1",
      quantity: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing productId", () => {
    expect(
      addItemSchema.safeParse({ productVariantId: "var_1", quantity: 1 }).success,
    ).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    const base = { productId: "prod_1", productVariantId: "var_1" };
    expect(addItemSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(addItemSchema.safeParse({ ...base, quantity: -1 }).success).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    expect(
      addItemSchema.safeParse({
        productId: "prod_1",
        productVariantId: "var_1",
        quantity: 1.5,
      }).success,
    ).toBe(false);
  });

  it("rejects a quantity above MAX_ITEM_QUANTITY", () => {
    expect(
      addItemSchema.safeParse({
        productId: "prod_1",
        productVariantId: "var_1",
        quantity: MAX_ITEM_QUANTITY + 1,
      }).success,
    ).toBe(false);
  });

  it("accepts a quantity exactly at MAX_ITEM_QUANTITY", () => {
    expect(
      addItemSchema.safeParse({
        productId: "prod_1",
        productVariantId: "var_1",
        quantity: MAX_ITEM_QUANTITY,
      }).success,
    ).toBe(true);
  });

  it("rejects a client-submitted price field (never accepted, silently ignored at best — proves the schema has no such field)", () => {
    const parsed = addItemSchema.safeParse({
      productId: "prod_1",
      productVariantId: "var_1",
      quantity: 1,
      unitPriceAmount: "1",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("unitPriceAmount");
    }
  });
});

describe("setItemQuantitySchema", () => {
  it("accepts a valid payload", () => {
    expect(setItemQuantitySchema.safeParse({ itemId: "item_1", quantity: 3 }).success).toBe(true);
  });

  it("rejects an empty itemId", () => {
    expect(setItemQuantitySchema.safeParse({ itemId: "", quantity: 1 }).success).toBe(false);
  });

  it("rejects a quantity above the limit", () => {
    expect(
      setItemQuantitySchema.safeParse({ itemId: "item_1", quantity: MAX_ITEM_QUANTITY + 1 }).success,
    ).toBe(false);
  });
});

describe("removeItemSchema", () => {
  it("accepts a valid payload", () => {
    expect(removeItemSchema.safeParse({ itemId: "item_1" }).success).toBe(true);
  });

  it("rejects a missing itemId", () => {
    expect(removeItemSchema.safeParse({}).success).toBe(false);
  });
});
