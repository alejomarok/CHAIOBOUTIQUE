import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ITEM_QUANTITY } from "@/modules/cart/constants";
import type { PublicVariantDTO } from "@/modules/products/public-queries";

const { addItemAction } = vi.hoisted(() => ({ addItemAction: vi.fn() }));
vi.mock("@/app/(public)/cart/actions", () => ({ addItemAction }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ProductVariantSelector } = await import("@/components/catalog/product-variant-selector");

const variants: PublicVariantDTO[] = [
  {
    id: "small-red",
    sku: "S-RED",
    sizeOptionId: "small",
    sizeName: "S",
    sizeSortOrder: 1,
    colorId: "red",
    colorName: "Rojo",
    priceDisplay: "$ 10.000",
    compareAtPriceDisplay: null,
    stockStatus: "IN_STOCK",
  },
  {
    id: "medium-blue",
    sku: "M-BLUE",
    sizeOptionId: "medium",
    sizeName: "M",
    sizeSortOrder: 2,
    colorId: "blue",
    colorName: "Azul",
    priceDisplay: "$ 10.000",
    compareAtPriceDisplay: null,
    stockStatus: "IN_STOCK",
  },
];

describe("ProductVariantSelector", () => {
  afterEach(cleanup);
  beforeEach(() => {
    addItemAction.mockReset();
    addItemAction.mockResolvedValue(undefined);
  });

  it("lets shoppers reach a size and color in a sparse variant matrix", async () => {
    render(<ProductVariantSelector productId="product" variants={variants} />);

    fireEvent.click(screen.getByRole("button", { name: /^M$/ }));
    expect(screen.getByRole("button", { name: /^M$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Azul" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    await waitFor(() =>
      expect(addItemAction).toHaveBeenCalledWith({
        productId: "product",
        productVariantId: "medium-blue",
        quantity: 1,
      }),
    );
  });

  it("keeps color options reachable and adjusts the size to a real combination", () => {
    render(<ProductVariantSelector productId="product" variants={variants} />);

    fireEvent.click(screen.getByRole("button", { name: "Azul" }));
    expect(screen.getByRole("button", { name: /^M$/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Rojo" }));
    expect(screen.getByRole("button", { name: /^S$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Rojo" })).toHaveAttribute("aria-pressed", "true");
  });

  it("caps the requested quantity at the server's cart limit", async () => {
    render(<ProductVariantSelector productId="product" variants={variants} />);
    const increment = screen.getByRole("button", { name: "Sumar cantidad" });
    for (let index = 0; index < MAX_ITEM_QUANTITY + 5; index++) fireEvent.click(increment);
    expect(increment).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    await waitFor(() =>
      expect(addItemAction).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: MAX_ITEM_QUANTITY }),
      ),
    );
  });

  it("keeps an out-of-stock combination visible but prevents purchasing it", () => {
    const outOfStock = variants.map((variant) => ({
      ...variant,
      stockStatus: "OUT_OF_STOCK" as const,
    }));
    render(<ProductVariantSelector productId="product" variants={outOfStock} />);
    fireEvent.click(screen.getByRole("button", { name: /^M$/ }));
    expect(screen.getByRole("button", { name: "Sin stock" })).toBeDisabled();
    expect(addItemAction).not.toHaveBeenCalled();
  });
});
