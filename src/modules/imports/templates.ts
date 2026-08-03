import type { ImportType } from "@/generated/prisma/client";

import { buildCsv } from "./csv";
import { IMPORT_TEMPLATE_HEADERS } from "./row-schemas";

// One documented example row per import type — illustrates the expected
// format (e.g. how a money field is written) without being real data.
const EXAMPLE_ROWS: Record<ImportType, Record<string, string>> = {
  CATEGORIES: {
    legacyId: "CAT-001",
    name: "Remeras",
    parentLegacyId: "",
    description: "",
    displayOrder: "0",
  },
  BRANDS: { legacyId: "BR-001", name: "Marca Ejemplo", description: "" },
  PRODUCTS: {
    legacyId: "PROD-001",
    name: "Remera básica",
    categoryLegacyId: "CAT-001",
    brandLegacyId: "BR-001",
    internalCode: "",
    shortDescription: "",
    description: "",
    defaultPriceAmount: "15000,50",
    compareAtPriceAmount: "",
    referenceCostAmount: "",
    minimumStockThreshold: "",
  },
  VARIANTS: {
    productLegacyId: "PROD-001",
    sku: "REM-001-M-AZUL",
    barcode: "",
    sizeGroupCode: "TOPS",
    sizeOptionCode: "M",
    colorKey: "azul",
    priceAmount: "",
    compareAtPriceAmount: "",
    costAmount: "",
  },
  INITIAL_STOCK: { sku: "REM-001-M-AZUL", warehouseCode: "MAIN", quantity: "10", legacyId: "" },
};

export function generateImportTemplateCsv(importType: ImportType): string {
  const headers = IMPORT_TEMPLATE_HEADERS[importType];
  return buildCsv(headers, [EXAMPLE_ROWS[importType]]);
}

export interface ErrorReportRow {
  rowNumber: number;
  field?: string;
  errorCode: string;
  message: string;
}

export function buildImportErrorReportCsv(issues: ErrorReportRow[]): string {
  const headers = ["rowNumber", "field", "errorCode", "message"];
  return buildCsv(
    headers,
    issues.map((issue) => ({
      rowNumber: String(issue.rowNumber),
      field: issue.field ?? "",
      errorCode: issue.errorCode,
      message: issue.message,
    })),
  );
}
