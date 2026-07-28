import "server-only";

import type { ImportBatch, Prisma } from "@/generated/prisma/client";
import { Prisma as PrismaRuntime } from "@/generated/prisma/client";
import { ensureUniqueSlug } from "@/lib/slug";
import { recordAuditLog } from "@/modules/audit";
import { applyInventoryOperation } from "@/modules/inventory/service";
import { buildImportIdempotencyKey } from "@/modules/inventory/idempotency";
import { validateCompareAtPrice } from "@/modules/products/pricing";

import { ImportRowError } from "./errors";
import type {
  BrandImportRow,
  CategoryImportRow,
  InitialStockImportRow,
  ProductImportRow,
  VariantImportRow,
} from "./row-schemas";

// Every row processor runs inside the single per-row `tx` opened by
// modules/imports/service.ts's runImport — never its own transaction (no
// nested transactions; see modules/inventory/service.ts's
// applyInventoryOperation doc comment for the same rule applied to
// transfers). A thrown ImportRowError is caught by the caller and recorded
// as a non-fatal ImportIssue; any other thrown error is also caught there
// and recorded as a generic execution error — a bad row never rolls back
// rows already committed before it.
//
// Known limitation, documented rather than solved this phase: catalog rows
// are processed in file order, single-pass — a category row referencing a
// parentLegacyId that appears *later* in the same file will fail with
// PARENT_NOT_FOUND. CSVs must list parents before children. See
// DATABASE.md "Migration readiness".

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export async function processCategoryRow(
  tx: Prisma.TransactionClient,
  row: CategoryImportRow,
  batch: ImportBatch,
  actorId: string,
): Promise<void> {
  let parentId: string | null = null;
  if (row.parentLegacyId) {
    const parent = await tx.category.findUnique({
      where: {
        legacySource_legacyId: { legacySource: batch.sourceSystem, legacyId: row.parentLegacyId },
      },
    });
    if (!parent) {
      throw new ImportRowError(
        "PARENT_NOT_FOUND",
        `parentLegacyId "${row.parentLegacyId}" no fue encontrado (¿aparece después en el archivo?).`,
      );
    }
    parentId = parent.id;
  }

  const existing = await tx.category.findUnique({
    where: { legacySource_legacyId: { legacySource: batch.sourceSystem, legacyId: row.legacyId } },
  });

  const categoryId = existing
    ? (
        await tx.category.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            parentId,
            description: row.description,
            displayOrder: row.displayOrder ?? existing.displayOrder,
          },
        })
      ).id
    : (
        await tx.category.create({
          data: {
            name: row.name,
            slug: await ensureUniqueSlug(
              row.name,
              async (candidate) => (await tx.category.count({ where: { slug: candidate } })) > 0,
            ),
            parentId,
            description: row.description,
            displayOrder: row.displayOrder ?? 0,
            legacySource: batch.sourceSystem,
            legacyId: row.legacyId,
          },
        })
      ).id;

  await recordAuditLog(
    {
      userId: actorId,
      action: existing ? "category.imported_updated" : "category.imported_created",
      entityType: "Category",
      entityId: categoryId,
      newValue: { legacyId: row.legacyId, name: row.name },
      correlationId: batch.id,
    },
    tx,
  );
}

export async function processBrandRow(
  tx: Prisma.TransactionClient,
  row: BrandImportRow,
  batch: ImportBatch,
  actorId: string,
): Promise<void> {
  const existing = await tx.brand.findUnique({
    where: { legacySource_legacyId: { legacySource: batch.sourceSystem, legacyId: row.legacyId } },
  });

  const brandId = existing
    ? (
        await tx.brand.update({
          where: { id: existing.id },
          data: { name: row.name, description: row.description },
        })
      ).id
    : (
        await tx.brand.create({
          data: {
            name: row.name,
            slug: await ensureUniqueSlug(
              row.name,
              async (candidate) => (await tx.brand.count({ where: { slug: candidate } })) > 0,
            ),
            description: row.description,
            legacySource: batch.sourceSystem,
            legacyId: row.legacyId,
          },
        })
      ).id;

  await recordAuditLog(
    {
      userId: actorId,
      action: existing ? "brand.imported_updated" : "brand.imported_created",
      entityType: "Brand",
      entityId: brandId,
      newValue: { legacyId: row.legacyId, name: row.name },
      correlationId: batch.id,
    },
    tx,
  );
}

export async function processProductRow(
  tx: Prisma.TransactionClient,
  row: ProductImportRow,
  batch: ImportBatch,
  actorId: string,
): Promise<void> {
  let categoryId: string | null = null;
  if (row.categoryLegacyId) {
    const category = await tx.category.findUnique({
      where: {
        legacySource_legacyId: { legacySource: batch.sourceSystem, legacyId: row.categoryLegacyId },
      },
    });
    if (!category) {
      throw new ImportRowError(
        "CATEGORY_NOT_FOUND",
        `categoryLegacyId "${row.categoryLegacyId}" no fue encontrado.`,
      );
    }
    categoryId = category.id;
  }

  let brandId: string | null = null;
  if (row.brandLegacyId) {
    const brand = await tx.brand.findUnique({
      where: { legacySource_legacyId: { legacySource: batch.sourceSystem, legacyId: row.brandLegacyId } },
    });
    if (!brand) {
      throw new ImportRowError("BRAND_NOT_FOUND", `brandLegacyId "${row.brandLegacyId}" no fue encontrado.`);
    }
    brandId = brand.id;
  }

  validateCompareAtPrice(row.defaultPriceAmount, row.compareAtPriceAmount);

  const existing = await tx.product.findUnique({
    where: { legacySource_legacyId: { legacySource: batch.sourceSystem, legacyId: row.legacyId } },
  });

  const data = {
    name: row.name,
    categoryId,
    brandId,
    internalCode: row.internalCode,
    shortDescription: row.shortDescription,
    description: row.description,
    defaultPriceAmount: row.defaultPriceAmount,
    compareAtPriceAmount: row.compareAtPriceAmount,
    referenceCostAmount: row.referenceCostAmount,
    minimumStockThreshold: row.minimumStockThreshold,
  };

  let productId: string;
  try {
    if (existing) {
      productId = (
        await tx.product.update({ where: { id: existing.id }, data: { ...data, updatedById: actorId } })
      ).id;
    } else {
      productId = (
        await tx.product.create({
          data: {
            ...data,
            slug: await ensureUniqueSlug(
              row.name,
              async (candidate) => (await tx.product.count({ where: { slug: candidate } })) > 0,
            ),
            legacySource: batch.sourceSystem,
            legacyId: row.legacyId,
            createdById: actorId,
            updatedById: actorId,
          },
        })
      ).id;
    }
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ImportRowError(
        "DUPLICATE_INTERNAL_CODE",
        `internalCode "${row.internalCode ?? ""}" ya está en uso por otro producto.`,
      );
    }
    throw error;
  }

  await recordAuditLog(
    {
      userId: actorId,
      action: existing ? "product.imported_updated" : "product.imported_created",
      entityType: "Product",
      entityId: productId,
      newValue: { legacyId: row.legacyId, name: row.name },
      correlationId: batch.id,
    },
    tx,
  );
}

export async function processVariantRow(
  tx: Prisma.TransactionClient,
  row: VariantImportRow,
  batch: ImportBatch,
  actorId: string,
): Promise<void> {
  const product = await tx.product.findUnique({
    where: {
      legacySource_legacyId: { legacySource: batch.sourceSystem, legacyId: row.productLegacyId },
    },
  });
  if (!product) {
    throw new ImportRowError(
      "PRODUCT_NOT_FOUND",
      `productLegacyId "${row.productLegacyId}" no fue encontrado.`,
    );
  }

  let sizeId: string | null = null;
  if (row.sizeKey) {
    const size = await tx.size.findUnique({ where: { key: row.sizeKey } });
    if (!size) throw new ImportRowError("SIZE_NOT_FOUND", `sizeKey "${row.sizeKey}" no fue encontrado.`);
    sizeId = size.id;
  }

  let colorId: string | null = null;
  if (row.colorKey) {
    const color = await tx.color.findUnique({ where: { key: row.colorKey } });
    if (!color) throw new ImportRowError("COLOR_NOT_FOUND", `colorKey "${row.colorKey}" no fue encontrado.`);
    colorId = color.id;
  }

  const effectivePrice = row.priceAmount ?? product.defaultPriceAmount;
  validateCompareAtPrice(effectivePrice, row.compareAtPriceAmount);

  const existing = await tx.productVariant.findUnique({ where: { sku: row.sku } });

  try {
    const variantId = existing
      ? (
          await tx.productVariant.update({
            where: { id: existing.id },
            data: {
              sizeId,
              colorId,
              barcode: row.barcode,
              priceAmount: row.priceAmount,
              compareAtPriceAmount: row.compareAtPriceAmount,
              costAmount: row.costAmount,
            },
          })
        ).id
      : (
          await tx.productVariant.create({
            data: {
              productId: product.id,
              sizeId,
              colorId,
              sku: row.sku,
              barcode: row.barcode,
              priceAmount: row.priceAmount,
              compareAtPriceAmount: row.compareAtPriceAmount,
              costAmount: row.costAmount,
            },
          })
        ).id;

    await recordAuditLog(
      {
        userId: actorId,
        action: existing ? "product_variant.imported_updated" : "product_variant.imported_created",
        entityType: "ProductVariant",
        entityId: variantId,
        newValue: { sku: row.sku },
        correlationId: batch.id,
      },
      tx,
    );
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ImportRowError(
        "DUPLICATE_VARIANT_COMBINATION",
        `Ya existe una variante con esa combinación de talle/color para este producto, o el SKU/código de barras ya está en uso.`,
      );
    }
    throw error;
  }
}

export async function processInitialStockRow(
  tx: Prisma.TransactionClient,
  row: InitialStockImportRow,
  batch: ImportBatch,
  actorId: string,
): Promise<void> {
  const variant = await tx.productVariant.findUnique({ where: { sku: row.sku } });
  if (!variant) throw new ImportRowError("VARIANT_NOT_FOUND", `sku "${row.sku}" no fue encontrado.`);

  const warehouse = await tx.warehouse.findUnique({ where: { code: row.warehouseCode } });
  if (!warehouse) {
    throw new ImportRowError("WAREHOUSE_NOT_FOUND", `warehouseCode "${row.warehouseCode}" no fue encontrado.`);
  }

  // A zero-quantity row is a legitimate "no stock at this location" export
  // line, not an error — but InventoryMovement is append-only and a
  // zero-delta movement is meaningless, so it's a documented no-op rather
  // than a recorded operation.
  if (row.quantity === 0) return;

  // Scoped by (sourceSystem, row identity) — not importBatchId — so
  // re-uploading the same source file (or a corrected re-export containing
  // this same row) is safely idempotent regardless of which batch it lands
  // in. legacyId falls back to "sku:warehouseCode" when the source file
  // doesn't carry its own row id.
  const idempotencyKey = buildImportIdempotencyKey({
    operationType: "initial_stock",
    sourceSystem: batch.sourceSystem,
    legacyId: row.legacyId ?? `${row.sku}:${row.warehouseCode}`,
  });

  // applyInventoryOperation records its own audit log entry — no separate
  // recordAuditLog call needed here.
  await applyInventoryOperation(
    tx,
    {
      operationType: "IMPORT",
      idempotencyKey,
      correlationId: batch.id,
      actorId,
      importBatchId: batch.id,
      occurredAt: new Date(),
    },
    [
      {
        variantId: variant.id,
        warehouseId: warehouse.id,
        movementType: "INITIAL_STOCK",
        quantityDelta: row.quantity,
        relatedEntityType: "ImportBatch",
        relatedEntityId: batch.id,
      },
    ],
  );
}
