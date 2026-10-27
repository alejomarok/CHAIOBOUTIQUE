import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { permissions, deleteImage } = vi.hoisted(() => ({
  permissions: new Set<string>(),
  deleteImage: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span role="img" aria-label={alt} data-src={src} />
  ),
}));
vi.mock("@/modules/auth", () => ({ requirePermission: vi.fn(async () => ({ permissions })) }));
vi.mock("@/modules/attributes/service", () => ({ listSizeGroups: async () => [] }));
vi.mock("@/modules/brands/service", () => ({ listBrands: async () => [] }));
vi.mock("@/modules/categories/service", () => ({ listCategories: async () => [] }));
vi.mock("@/modules/products/service", () => ({
  getProductById: async () => ({
    id: "product-1",
    name: "Vestido",
    images: [{ id: "image-1", altText: "Foto actual del vestido", isPrimary: true }],
    defaultPriceAmount: null,
    compareAtPriceAmount: null,
    referenceCostAmount: null,
    minimumStockThreshold: null,
  }),
}));
vi.mock("@/modules/products/product-images", () => ({
  getProductImagePublicUrl: () => "https://images.example.com/photo.jpg",
}));
vi.mock("@/app/(admin)/admin/products/product-form", () => ({
  ProductForm: () => <p>Datos del producto</p>,
}));
vi.mock("@/app/(admin)/admin/products/[id]/image-actions", () => ({
  deleteProductImageAction: deleteImage,
  prepareProductImageUploadAction: vi.fn(),
  finalizeProductImageUploadAction: vi.fn(),
  reorderProductImageAction: vi.fn(),
  setPrimaryImageAction: vi.fn(),
}));
const { default: EditProductPage } = await import("@/app/(admin)/admin/products/[id]/edit/page");
beforeEach(() => {
  permissions.clear();
  permissions.add("products.edit");
  deleteImage.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("image management from Edit product", () => {
  it("shows current photos and upload/delete controls without leaving the edit screen", async () => {
    permissions.add("product_images.manage");
    const { container } = render(
      await EditProductPage({ params: Promise.resolve({ id: "product-1" }) }),
    );
    expect(screen.getByRole("img", { name: "Foto actual del vestido" })).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(deleteImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(deleteImage).toHaveBeenCalledWith({ imageId: "image-1", productId: "product-1" }),
    );
  });
  it("does not grant image management merely because the user may edit product data", async () => {
    const { container } = render(
      await EditProductPage({ params: Promise.resolve({ id: "product-1" }) }),
    );
    expect(screen.getByText("No tenés permiso para gestionar imágenes.")).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });
});
