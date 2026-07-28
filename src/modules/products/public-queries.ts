import "server-only";

import { minorUnitsToDisplay } from "@/lib/money";
import { prisma } from "@/lib/db";
import { getProductImagePublicUrl } from "@/modules/products/product-images";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

import { getEffectivePrice } from "./pricing";
import { isPubliclyVisible } from "./visibility";

// The single boundary between the catalog tables and anything public —
// /catalog and /product/[slug] call only this file, never
// modules/products/service.ts directly. Never returns cost, legacySource/
// legacyId, internal notes, exact warehouse balances, or unpublished/
// inactive rows — see SECURITY.md.

export interface PublicProductCardDTO {
  id: string;
  name: string;
  slug: string;
  primaryImageUrl: string | null;
  priceDisplay: string | null;
  compareAtPriceDisplay: string | null;
}

export interface ListPublicProductsFilters {
  search?: string;
  categoryId?: string;
  brandId?: string;
  sizeId?: string;
  colorId?: string;
  sort?: "newest" | "price_asc" | "price_desc";
  take?: number;
  skip?: number;
}

function cheapestEffectivePrice(
  product: { defaultPriceAmount: bigint | null },
  variants: { priceAmount: bigint | null }[],
): bigint | null {
  const prices = variants
    .map((v) =>
      getEffectivePrice({
        variantPriceAmount: v.priceAmount,
        productDefaultPriceAmount: product.defaultPriceAmount,
      }),
    )
    .filter((p): p is bigint => p !== null);
  if (prices.length === 0) return null;
  return prices.reduce((min, price) => (price < min ? price : min));
}

export async function listPublicProducts(filters: ListPublicProductsFilters = {}) {
  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      categoryId: filters.categoryId ?? { not: null },
      brandId: filters.brandId,
      name: filters.search ? { contains: filters.search, mode: "insensitive" } : undefined,
      variants:
        filters.sizeId || filters.colorId
          ? { some: { isActive: true, sizeId: filters.sizeId, colorId: filters.colorId } }
          : undefined,
    },
    include: {
      variants: { where: { isActive: true } },
      images: { where: { isPrimary: true }, take: 1 },
    },
    orderBy:
      filters.sort === "price_asc"
        ? { defaultPriceAmount: "asc" }
        : filters.sort === "price_desc"
          ? { defaultPriceAmount: "desc" }
          : { createdAt: "desc" },
    take: filters.take ?? 24,
    skip: filters.skip ?? 0,
  });

  return products
    .filter((product) => isPubliclyVisible(product, product.variants))
    .map((product): PublicProductCardDTO => {
      const primaryImage = product.images[0];
      const price = cheapestEffectivePrice(product, product.variants);
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        primaryImageUrl: primaryImage ? getProductImagePublicUrl(primaryImage) : null,
        priceDisplay: price !== null ? minorUnitsToDisplay(price) : null,
        compareAtPriceDisplay:
          product.compareAtPriceAmount !== null
            ? minorUnitsToDisplay(product.compareAtPriceAmount)
            : null,
      };
    });
}

export type PublicStockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export interface PublicVariantDTO {
  id: string;
  sizeName: string | null;
  colorName: string | null;
  priceDisplay: string;
  compareAtPriceDisplay: string | null;
  stockStatus: PublicStockStatus;
}

export interface PublicProductImageDTO {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  isPrimary: boolean;
}

export interface PublicProductDetailDTO {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  images: PublicProductImageDTO[];
  variants: PublicVariantDTO[];
}

// "In stock" reads only the MAIN (isDefault) warehouse this phase — never
// summed across warehouses. See docs/adr/0002-inventory-balance-projection.md.
export async function getPublicProductBySlug(slug: string): Promise<PublicProductDetailDTO | null> {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      variants: { where: { isActive: true }, include: { size: true, color: true } },
      images: { orderBy: { displayOrder: "asc" } },
    },
  });

  if (!product || !isPubliclyVisible(product, product.variants)) return null;

  const defaultWarehouse = await getDefaultWarehouse();
  const balances = defaultWarehouse
    ? await prisma.inventoryBalance.findMany({
        where: {
          warehouseId: defaultWarehouse.id,
          variantId: { in: product.variants.map((v) => v.id) },
        },
      })
    : [];

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    images: product.images.map((image) => ({
      url: getProductImagePublicUrl(image),
      altText: image.altText,
      width: image.width,
      height: image.height,
      isPrimary: image.isPrimary,
    })),
    variants: product.variants.map((variant) => {
      // Non-null: isPubliclyVisible already guaranteed every active variant
      // has a valid effective price.
      const price = getEffectivePrice({
        variantPriceAmount: variant.priceAmount,
        productDefaultPriceAmount: product.defaultPriceAmount,
      })!;
      const compareAt = variant.compareAtPriceAmount ?? product.compareAtPriceAmount;
      const balance = balances.find((b) => b.variantId === variant.id);
      const quantity = balance?.quantity ?? 0;

      let stockStatus: PublicStockStatus = "IN_STOCK";
      if (quantity <= 0) stockStatus = "OUT_OF_STOCK";
      else if (product.minimumStockThreshold != null && quantity <= product.minimumStockThreshold) {
        stockStatus = "LOW_STOCK";
      }

      return {
        id: variant.id,
        sizeName: variant.size?.displayName ?? null,
        colorName: variant.color?.displayName ?? null,
        priceDisplay: minorUnitsToDisplay(price),
        compareAtPriceDisplay: compareAt !== null ? minorUnitsToDisplay(compareAt) : null,
        stockStatus,
      };
    }),
  };
}
