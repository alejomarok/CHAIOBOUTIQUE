import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPublicProducts, listCategories } = vi.hoisted(() => ({
  listPublicProducts: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock("@/modules/products/public-queries", () => ({ listPublicProducts }));
vi.mock("@/modules/categories/service", () => ({ listCategories }));
vi.mock("@/components/catalog/catalog-filters", () => ({
  CatalogFilters: () => <div>Filtros</div>,
}));
vi.mock("@/components/catalog/catalog-filters-sheet", () => ({ CatalogFiltersSheet: () => null }));
vi.mock("@/components/catalog/product-card", () => ({
  ProductCard: ({ product }: { product: { name: string } }) => <article>{product.name}</article>,
}));

const { default: CatalogPage } = await import("@/app/(public)/catalog/page");
const products = Array.from({ length: 25 }, (_, index) => ({
  id: String(index),
  name: `Prenda ${index}`,
}));

describe("catalog pagination", () => {
  afterEach(cleanup);
  beforeEach(() => {
    listCategories.mockResolvedValue([]);
    listPublicProducts.mockResolvedValue(products);
  });

  it("renders 24 products and preserves search, category, and sort on the next page", async () => {
    render(
      await CatalogPage({
        searchParams: Promise.resolve({
          q: "vestido azul",
          category: "vestidos",
          sort: "price_asc",
        }),
      }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(24);
    const nextHref = screen.getByRole("link", { name: "Siguiente" }).getAttribute("href");
    const query = new URL(nextHref!, "http://localhost").searchParams;
    expect(query.get("q")).toBe("vestido azul");
    expect(query.get("category")).toBe("vestidos");
    expect(query.get("sort")).toBe("price_asc");
    expect(query.get("page")).toBe("2");
    expect(screen.queryByRole("link", { name: "Anterior" })).not.toBeInTheDocument();
  });

  it("provides a way back from an empty later page", async () => {
    listPublicProducts.mockResolvedValue([]);
    render(await CatalogPage({ searchParams: Promise.resolve({ page: "3", q: "camisa" }) }));
    expect(screen.getByRole("link", { name: "Volver a la página anterior" })).toHaveAttribute(
      "href",
      "/catalog?q=camisa&sort=newest&page=2",
    );
    expect(screen.queryByRole("link", { name: "Siguiente" })).not.toBeInTheDocument();
  });

  it.each(["Infinity", "-2", "1.5", "hello", "999999999999999"])(
    "treats an invalid page %s as the first page",
    async (page) => {
      render(await CatalogPage({ searchParams: Promise.resolve({ page }) }));
      expect(listPublicProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
      expect(screen.getByText("Página 1")).toBeInTheDocument();
    },
  );
});
