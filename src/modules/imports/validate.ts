// Pure validation — schema-checks a parsed CSV against its import type's row
// schema and flags duplicate business keys *within the file itself*. No
// Prisma, no I/O, so this is testable without a database. DB-side
// resolution (does categoryLegacyId actually exist, is this sku already
// taken by another product, etc.) happens later, only during execution, in
// modules/imports/row-processors.ts — this step alone is what
// "parseAndValidateCsv (dry-run)" means for this phase.
import type { ImportType } from "@/generated/prisma/client";

import type { CsvRow } from "./csv";
import { IMPORT_ROW_SCHEMAS } from "./row-schemas";

export interface RowIssue {
  rowNumber: number;
  field?: string;
  errorCode: string;
  message: string;
  rawRowSnapshot: CsvRow;
}

export interface ValidRow<T = unknown> {
  rowNumber: number;
  data: T;
  raw: CsvRow;
}

export interface ValidateImportRowsResult {
  validRows: ValidRow[];
  issues: RowIssue[];
}

// The within-file dedup key per import type — mirrors the DB-level identity
// each row processor upserts on (legacySource+legacyId for
// Category/Brand/Product, sku for Variant/InitialStock+warehouse).
function dedupeKey(importType: ImportType, data: Record<string, unknown>): string | null {
  switch (importType) {
    case "CATEGORIES":
    case "BRANDS":
    case "PRODUCTS":
      return `legacyId:${data.legacyId as string}`;
    case "VARIANTS":
      return `sku:${data.sku as string}`;
    case "INITIAL_STOCK":
      return `sku_warehouse:${data.sku as string}:${data.warehouseCode as string}`;
  }
}

export function validateImportRows(
  importType: ImportType,
  rows: CsvRow[],
): ValidateImportRowsResult {
  const schema = IMPORT_ROW_SCHEMAS[importType];
  const validRows: ValidRow[] = [];
  const issues: RowIssue[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((raw, index) => {
    // +2: 1-based, plus the header line.
    const rowNumber = index + 2;
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          rowNumber,
          field: issue.path.join(".") || undefined,
          errorCode: "VALIDATION",
          message: issue.message,
          rawRowSnapshot: raw,
        });
      }
      return;
    }

    const key = dedupeKey(importType, parsed.data as Record<string, unknown>);
    if (key) {
      if (seenKeys.has(key)) {
        issues.push({
          rowNumber,
          errorCode: "DUPLICATE_IN_FILE",
          message: `Esta fila repite una clave ya usada antes en el mismo archivo (${key}).`,
          rawRowSnapshot: raw,
        });
        return;
      }
      seenKeys.add(key);
    }

    validRows.push({ rowNumber, data: parsed.data, raw });
  });

  return { validRows, issues };
}
