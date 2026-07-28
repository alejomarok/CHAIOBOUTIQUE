import { z } from "zod";

import { displayToMinorUnits } from "@/lib/money";

// Generic, documented CSV column set per import type — this phase's
// migration foundation, not a mapping for any specific legacy system (that
// waits for a real sample export; see DATABASE.md / INTEGRATIONS.md). Every
// row schema takes the raw string-keyed CSV row and produces a typed,
// validated row; a failed parse never touches the database — see
// modules/imports/service.ts.

function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null));
}

function requiredText(label: string) {
  return z.string().trim().min(1, `${label} es obligatorio.`);
}

function optionalMoney() {
  return z
    .string()
    .trim()
    .optional()
    .transform((val, ctx) => {
      if (!val) return null;
      try {
        return displayToMinorUnits(val);
      } catch {
        ctx.addIssue({ code: "custom", message: `Monto inválido: "${val}".` });
        return z.NEVER;
      }
    });
}

function optionalInt() {
  return z
    .string()
    .trim()
    .optional()
    .transform((val, ctx) => {
      if (!val) return null;
      const parsed = Number(val);
      if (!Number.isInteger(parsed)) {
        ctx.addIssue({ code: "custom", message: `Número entero inválido: "${val}".` });
        return z.NEVER;
      }
      return parsed;
    });
}

export const categoryImportRowSchema = z.object({
  legacyId: requiredText("legacyId"),
  name: requiredText("name"),
  parentLegacyId: optionalText(),
  description: optionalText(),
  displayOrder: optionalInt(),
});
export type CategoryImportRow = z.infer<typeof categoryImportRowSchema>;

export const brandImportRowSchema = z.object({
  legacyId: requiredText("legacyId"),
  name: requiredText("name"),
  description: optionalText(),
});
export type BrandImportRow = z.infer<typeof brandImportRowSchema>;

export const productImportRowSchema = z.object({
  legacyId: requiredText("legacyId"),
  name: requiredText("name"),
  categoryLegacyId: optionalText(),
  brandLegacyId: optionalText(),
  internalCode: optionalText(),
  shortDescription: optionalText(),
  description: optionalText(),
  defaultPriceAmount: optionalMoney(),
  compareAtPriceAmount: optionalMoney(),
  referenceCostAmount: optionalMoney(),
  minimumStockThreshold: optionalInt(),
});
export type ProductImportRow = z.infer<typeof productImportRowSchema>;

export const variantImportRowSchema = z.object({
  productLegacyId: requiredText("productLegacyId"),
  sku: requiredText("sku"),
  barcode: optionalText(),
  sizeKey: optionalText(),
  colorKey: optionalText(),
  priceAmount: optionalMoney(),
  compareAtPriceAmount: optionalMoney(),
  costAmount: optionalMoney(),
});
export type VariantImportRow = z.infer<typeof variantImportRowSchema>;

export const initialStockImportRowSchema = z.object({
  sku: requiredText("sku"),
  warehouseCode: requiredText("warehouseCode"),
  quantity: z
    .string()
    .trim()
    .transform((val, ctx) => {
      const parsed = Number(val);
      if (!Number.isInteger(parsed) || parsed < 0) {
        ctx.addIssue({ code: "custom", message: `Cantidad inválida: "${val}".` });
        return z.NEVER;
      }
      return parsed;
    }),
  legacyId: optionalText(),
});
export type InitialStockImportRow = z.infer<typeof initialStockImportRowSchema>;

export const IMPORT_ROW_SCHEMAS = {
  CATEGORIES: categoryImportRowSchema,
  BRANDS: brandImportRowSchema,
  PRODUCTS: productImportRowSchema,
  VARIANTS: variantImportRowSchema,
  INITIAL_STOCK: initialStockImportRowSchema,
} as const;

export const IMPORT_TEMPLATE_HEADERS: Record<keyof typeof IMPORT_ROW_SCHEMAS, string[]> = {
  CATEGORIES: ["legacyId", "name", "parentLegacyId", "description", "displayOrder"],
  BRANDS: ["legacyId", "name", "description"],
  PRODUCTS: [
    "legacyId",
    "name",
    "categoryLegacyId",
    "brandLegacyId",
    "internalCode",
    "shortDescription",
    "description",
    "defaultPriceAmount",
    "compareAtPriceAmount",
    "referenceCostAmount",
    "minimumStockThreshold",
  ],
  VARIANTS: [
    "productLegacyId",
    "sku",
    "barcode",
    "sizeKey",
    "colorKey",
    "priceAmount",
    "compareAtPriceAmount",
    "costAmount",
  ],
  INITIAL_STOCK: ["sku", "warehouseCode", "quantity", "legacyId"],
};
