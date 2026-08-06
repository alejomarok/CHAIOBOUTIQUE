import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A deterministic, fast regression guard for the Select controls' accessible
// naming — pins the contract e2e relies on (getByLabel/getByRole("combobox",
// { name })) without depending on browser timing. See product-publish.spec.ts,
// which drives this same form over real HTTP.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/(admin)/admin/products/actions", () => ({
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
}));

const { ProductForm } = await import("@/app/(admin)/admin/products/product-form");

describe("ProductForm — Select field accessibility", () => {
  afterEach(cleanup);

  const categories = [{ id: "cat-1", name: "Remeras" }];
  const brands = [{ id: "brand-1", name: "Marca Test" }];
  const sizeGroups = [{ id: "sg-1", name: "Indumentaria" }];

  it('"Categoría" combobox has an accessible name matching its visible label', () => {
    render(
      <ProductForm
        categories={categories}
        brands={brands}
        sizeGroups={sizeGroups}
        canViewCost={false}
      />,
    );

    // Both query strategies an assistive-technology user or an e2e test
    // would use must independently resolve to the exact same element.
    const byLabel = screen.getByLabelText("Categoría");
    const byRole = screen.getByRole("combobox", { name: "Categoría" });
    expect(byLabel).toBe(byRole);
  });

  it('"Marca" combobox has an accessible name matching its visible label', () => {
    render(
      <ProductForm
        categories={categories}
        brands={brands}
        sizeGroups={sizeGroups}
        canViewCost={false}
      />,
    );

    expect(screen.getByLabelText("Marca")).toBe(
      screen.getByRole("combobox", { name: "Marca" }),
    );
  });

  it('"Grupo de talles" combobox has an accessible name matching its visible label', () => {
    render(
      <ProductForm
        categories={categories}
        brands={brands}
        sizeGroups={sizeGroups}
        canViewCost={false}
      />,
    );

    expect(screen.getByLabelText("Grupo de talles")).toBe(
      screen.getByRole("combobox", { name: "Grupo de talles" }),
    );
  });

  it("every combobox on the form has a unique, non-empty accessible name", () => {
    render(
      <ProductForm
        categories={categories}
        brands={brands}
        sizeGroups={sizeGroups}
        canViewCost={false}
      />,
    );

    const comboboxes = screen.getAllByRole("combobox");
    const names = comboboxes.map((el) => el.getAttribute("id"));
    expect(names.every((id) => !!id)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
