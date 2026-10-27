import "server-only";

import { minorUnitsToDisplay } from "@/lib/money";
import { prisma } from "@/lib/db";
import { getAvailableToSellForVariants } from "@/modules/inventory/service";
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
  sizeOptionId?: string;
  colorId?: string;
  newArrivalsOnly?: boolean;
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
      createdAt: filters.newArrivalsOnly
        ? { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        : undefined,
      categoryId: filters.categoryId ?? { not: null },
      brandId: filters.brandId,
      name: filters.search ? { contains: filters.search, mode: "insensitive" } : undefined,
      variants:
        filters.sizeOptionId || filters.colorId
          ? {
              some: {
                isActive: true,
                sizeOptionId: filters.sizeOptionId,
                colorId: filters.colorId,
              },
            }
          : undefined,
    },
    // Explicit select, not a bare `include` — this file's own header
    // comment already promises "never returns cost, legacySource/legacyId,
    // internal notes..." for the DTOs it RETURNS; this scopes the actual
    // DATABASE READ to match, so a future internal-only Product/variant
    // column (like taxCategory) is never even fetched by the public
    // storefront path, let alone exposed. List every field this function's
    // own isPubliclyVisible/cheapestEffectivePrice/DTO-mapping logic below
    // actually reads — nothing more.
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      categoryId: true,
      defaultPriceAmount: true,
      compareAtPriceAmount: true,
      variants: { where: { isActive: true }, select: { isActive: true, priceAmount: true } },
      images: { where: { isPrimary: true }, take: 1, select: { bucket: true, path: true } },
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
  sku: string;
  sizeOptionId: string | null;
  sizeName: string | null;
  // Ordering key for the size selector — SizeOption.sortOrder, never an
  // alphabetical sort of sizeName (which would put "10" before "9"). Null
  // for an axis-less variant, sorted first by the UI's own comparator.
  sizeSortOrder: number | null;
  colorId: string | null;
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
  categoryName: string | null;
  brandName: string | null;
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
    // See listPublicProducts's identical comment — explicit select, never
    // a bare include, so the public product-detail path never fetches
    // internal-only fields (cost, taxCategory, legacySource, ...) in the
    // first place.
    select: {
      id: true,
      name: true,
      slug: true,
      shortDescription: true,
      description: true,
      seoTitle: true,
      seoDescription: true,
      status: true,
      categoryId: true,
      defaultPriceAmount: true,
      compareAtPriceAmount: true,
      minimumStockThreshold: true,
      variants: {
        where: { isActive: true },
        select: {
          id: true,
          sku: true,
          sizeOptionId: true,
          colorId: true,
          isActive: true,
          priceAmount: true,
          compareAtPriceAmount: true,
          sizeOption: true,
          color: true,
        },
        // Size options ordered by their own sortOrder (never an
        // alphabetical sort of the label, which would put "10" before
        // "9") — see SizeOption.sortOrder's schema comment. Color has no
        // equivalent requirement; ordered by its own displayOrder for a
        // stable, admin-controlled sequence rather than insertion order.
        orderBy: [{ sizeOption: { sortOrder: "asc" } }, { color: { displayOrder: "asc" } }],
      },
      images: {
        orderBy: { displayOrder: "asc" },
        select: {
          bucket: true,
          path: true,
          altText: true,
          width: true,
          height: true,
          isPrimary: true,
        },
      },
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });

  if (!product || !isPubliclyVisible(product, product.variants)) return null;

  // Phase — Online Orders & Checkout foundation. AVAILABLE-TO-SELL (on-hand
  // minus ACTIVE reservations), never raw on-hand — see
  // getAvailableToSellForVariants's own comment. A unit already reserved by
  // someone else's pending Order must show as unavailable here, exactly
  // like it does in the cart and at checkout.
  const defaultWarehouse = await getDefaultWarehouse();
  const availableByVariant = defaultWarehouse
    ? await getAvailableToSellForVariants(
        product.variants.map((v) => v.id),
        defaultWarehouse.id,
      )
    : new Map<string, number>();

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    categoryName: product.category?.name ?? null,
    brandName: product.brand?.name ?? null,
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
      const quantity = availableByVariant.get(variant.id) ?? 0;

      let stockStatus: PublicStockStatus = "IN_STOCK";
      if (quantity <= 0) stockStatus = "OUT_OF_STOCK";
      else if (product.minimumStockThreshold != null && quantity <= product.minimumStockThreshold) {
        stockStatus = "LOW_STOCK";
      }

      return {
        id: variant.id,
        sku: variant.sku,
        sizeOptionId: variant.sizeOptionId,
        sizeName: variant.sizeOption?.label ?? null,
        sizeSortOrder: variant.sizeOption?.sortOrder ?? null,
        colorId: variant.colorId,
        colorName: variant.color?.displayName ?? null,
        priceDisplay: minorUnitsToDisplay(price),
        compareAtPriceDisplay: compareAt !== null ? minorUnitsToDisplay(compareAt) : null,
        stockStatus,
      };
    }),
  };
}
