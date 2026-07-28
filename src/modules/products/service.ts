import "server-only";

import { serializeMoney } from "@/lib/money";
import { prisma } from "@/lib/db";
import { ensureUniqueSlug } from "@/lib/slug";
import { recordAuditLog } from "@/modules/audit";
import type { Product, ProductStatus, ProductVariant } from "@/generated/prisma/client";

import { getEffectivePrice, validateCompareAtPrice } from "./pricing";
import { findDuplicateCombinationsInBatch, type VariantAxisCombination } from "./variant-matrix";

export class ProductNotReadyForPublicationError extends Error {
  constructor(reason: string) {
    super(`El producto no puede publicarse: ${reason}`);
    this.name = "ProductNotReadyForPublicationError";
  }
}

export class DuplicateVariantCombinationError extends Error {
  constructor() {
    super("Ya existe una variante con esa combinación de talle y color.");
    this.name = "DuplicateVariantCombinationError";
  }
}

export async function listProducts() {
  return prisma.product.findMany({
    include: {
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      variants: { select: { id: true, isActive: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      brand: true,
      variants: { include: { size: true, color: true }, orderBy: { createdAt: "asc" } },
      images: { orderBy: { displayOrder: "asc" } },
    },
  });
}

export interface ProductDTO {
  id: string;
  internalCode: string | null;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  status: ProductStatus;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  defaultPriceAmount: string | null;
  compareAtPriceAmount: string | null;
  referenceCostAmount: string | null | undefined;
  minimumStockThreshold: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// The single place that decides whether a caller sees cost data — called
// everywhere product data leaves the service layer, both admin and public,
// so redaction never depends on a per-page decision that could be gotten
// wrong on one screen and not another.
export function toProductDTO(product: Product, options: { includeCost: boolean }): ProductDTO {
  return {
    id: product.id,
    internalCode: product.internalCode,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    categoryId: product.categoryId,
    brandId: product.brandId,
    status: product.status,
    isFeatured: product.isFeatured,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    defaultPriceAmount:
      product.defaultPriceAmount !== null ? serializeMoney(product.defaultPriceAmount) : null,
    compareAtPriceAmount:
      product.compareAtPriceAmount !== null ? serializeMoney(product.compareAtPriceAmount) : null,
    referenceCostAmount: options.includeCost
      ? product.referenceCostAmount !== null
        ? serializeMoney(product.referenceCostAmount)
        : null
      : undefined,
    minimumStockThreshold: product.minimumStockThreshold,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export interface CreateProductInput {
  name: string;
  internalCode?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  defaultPriceAmount?: bigint | null;
  compareAtPriceAmount?: bigint | null;
  referenceCostAmount?: bigint | null;
  minimumStockThreshold?: number | null;
}

export async function createProduct(input: CreateProductInput, actorId: string): Promise<Product> {
  validateCompareAtPrice(input.defaultPriceAmount ?? null, input.compareAtPriceAmount);

  const slug = await ensureUniqueSlug(
    input.name,
    async (candidate) => (await prisma.product.count({ where: { slug: candidate } })) > 0,
  );

  const product = await prisma.product.create({
    data: {
      name: input.name,
      slug,
      internalCode: input.internalCode ?? null,
      shortDescription: input.shortDescription ?? null,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      defaultPriceAmount: input.defaultPriceAmount ?? null,
      compareAtPriceAmount: input.compareAtPriceAmount ?? null,
      referenceCostAmount: input.referenceCostAmount ?? null,
      minimumStockThreshold: input.minimumStockThreshold ?? null,
      createdById: actorId,
      updatedById: actorId,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "product.created",
    entityType: "Product",
    entityId: product.id,
    newValue: { name: product.name, slug: product.slug, status: product.status },
  });

  return product;
}

export interface UpdateProductInput {
  name?: string;
  internalCode?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  defaultPriceAmount?: bigint | null;
  compareAtPriceAmount?: bigint | null;
  referenceCostAmount?: bigint | null;
  minimumStockThreshold?: number | null;
}

export async function updateProduct(id: string, input: UpdateProductInput, actorId: string) {
  const before = await prisma.product.findUniqueOrThrow({ where: { id } });

  const nextDefaultPrice =
    input.defaultPriceAmount !== undefined ? input.defaultPriceAmount : before.defaultPriceAmount;
  const nextCompareAt =
    input.compareAtPriceAmount !== undefined
      ? input.compareAtPriceAmount
      : before.compareAtPriceAmount;
  validateCompareAtPrice(nextDefaultPrice, nextCompareAt);

  const product = await prisma.product.update({
    where: { id },
    data: { ...input, updatedById: actorId },
  });

  await recordAuditLog({
    userId: actorId,
    action: "product.updated",
    entityType: "Product",
    entityId: id,
    previousValue: { name: before.name, status: before.status },
    newValue: { name: product.name, status: product.status },
  });

  return product;
}

// Publication readiness mirrors modules/products/visibility.ts's public
// rule, checked at the moment status is set to ACTIVE (not only at read
// time) so an admin gets immediate, specific feedback instead of a
// silently-invisible product.
export async function setProductStatus(
  id: string,
  status: ProductStatus,
  actorId: string,
): Promise<Product> {
  const before = await prisma.product.findUniqueOrThrow({
    where: { id },
    include: { variants: { where: { isActive: true } } },
  });

  if (status === "ACTIVE") {
    if (!before.categoryId) {
      throw new ProductNotReadyForPublicationError("no tiene categoría asignada.");
    }
    if (before.variants.length === 0) {
      throw new ProductNotReadyForPublicationError("no tiene ninguna variante activa.");
    }
    for (const variant of before.variants) {
      const price = getEffectivePrice({
        variantPriceAmount: variant.priceAmount,
        productDefaultPriceAmount: before.defaultPriceAmount,
      });
      if (price === null || price <= 0n) {
        throw new ProductNotReadyForPublicationError(
          `la variante "${variant.sku}" no tiene un precio válido.`,
        );
      }
    }
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      status,
      updatedById: actorId,
      archivedAt: status === "ARCHIVED" ? new Date() : before.archivedAt,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: status === "ARCHIVED" ? "product.archived" : "product.status_changed",
    entityType: "Product",
    entityId: id,
    previousValue: { status: before.status },
    newValue: { status: product.status },
  });

  return product;
}

export interface CreateVariantInput extends VariantAxisCombination {
  sku: string;
  barcode?: string | null;
  name?: string | null;
  priceAmount?: bigint | null;
  compareAtPriceAmount?: bigint | null;
  costAmount?: bigint | null;
}

// Bulk-creates variants for a product from a proposed combination matrix
// (see variant-matrix.ts) — checked for duplicate (sizeId, colorId) pairs
// against both each other and the product's existing variants before any
// insert, mirroring the DB-level uniqueness (a normal @@unique for the
// fully-specified case, 3 hand-added partial indexes for the null-axis
// cases — see schema.prisma / DATABASE.md). The DB constraints remain the
// actual source of truth; this is a fast-fail check, not a replacement.
export async function createVariants(
  productId: string,
  inputs: CreateVariantInput[],
  actorId: string,
): Promise<ProductVariant[]> {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const existing = await prisma.productVariant.findMany({
    where: { productId },
    select: { sizeId: true, colorId: true },
  });

  const duplicates = findDuplicateCombinationsInBatch(existing, inputs);
  if (duplicates.length > 0) throw new DuplicateVariantCombinationError();

  for (const input of inputs) {
    const effectivePrice = getEffectivePrice({
      variantPriceAmount: input.priceAmount ?? null,
      productDefaultPriceAmount: product.defaultPriceAmount,
    });
    validateCompareAtPrice(effectivePrice, input.compareAtPriceAmount);
  }

  const variants = await prisma.$transaction(
    inputs.map((input) =>
      prisma.productVariant.create({
        data: {
          productId,
          sizeId: input.sizeId,
          colorId: input.colorId,
          sku: input.sku,
          barcode: input.barcode ?? null,
          name: input.name ?? null,
          priceAmount: input.priceAmount ?? null,
          compareAtPriceAmount: input.compareAtPriceAmount ?? null,
          costAmount: input.costAmount ?? null,
        },
      }),
    ),
  );

  await recordAuditLog({
    userId: actorId,
    action: "product_variant.created",
    entityType: "Product",
    entityId: productId,
    newValue: { skus: variants.map((v) => v.sku) },
  });

  return variants;
}

// Variants are never hard-deleted from the UI this phase — only deactivated.
// Once inventory (Phase 2B) exists, this is where a "has stock or movement
// history" check gates whether a genuine removal is ever offered; until
// then, deactivation is the only supported path, which is always safe.
export async function deactivateVariant(
  variantId: string,
  actorId: string,
): Promise<ProductVariant> {
  const variant = await prisma.productVariant.update({
    where: { id: variantId },
    data: { isActive: false },
  });

  await recordAuditLog({
    userId: actorId,
    action: "product_variant.deactivated",
    entityType: "ProductVariant",
    entityId: variantId,
  });

  return variant;
}
