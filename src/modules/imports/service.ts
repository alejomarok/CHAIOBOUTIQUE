import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";
import { DuplicateOperationError } from "@/modules/inventory/errors";
import type { ImportBatch, ImportType, Prisma } from "@/generated/prisma/client";

import { CsvParseError, parseCsv } from "./csv";
import { ImportBatchNotCancellableError, ImportRowError } from "./errors";
import {
  processBrandRow,
  processCategoryRow,
  processInitialStockRow,
  processProductRow,
  processVariantRow,
} from "./row-processors";
import type { RowIssue } from "./validate";
import { validateImportRows } from "./validate";

const CANCELLABLE_STATUSES = ["UPLOADED", "VALIDATING", "READY"];

export async function listImportBatches() {
  return prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });
}

export async function getImportBatchById(id: string) {
  return prisma.importBatch.findUnique({
    where: { id },
    include: { issues: { orderBy: { rowNumber: "asc" } } },
  });
}

// Only offered as an explicit, after-the-fact "don't run this" annotation on
// a READY (dry-run-only) batch — there's no live async job to interrupt:
// runImport (below) is synchronous end-to-end within a single request, so a
// batch only ever sits in READY between a dry-run preview and the admin's
// next click. See DATABASE.md "Migration readiness".
export async function cancelImportBatch(batchId: string, actorId: string): Promise<ImportBatch> {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (!CANCELLABLE_STATUSES.includes(batch.status)) {
    throw new ImportBatchNotCancellableError();
  }

  const updated = await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: "CANCELLED" },
  });

  await recordAuditLog({
    userId: actorId,
    action: "import_batch.cancelled",
    entityType: "ImportBatch",
    entityId: batchId,
  });

  return updated;
}

export interface RunImportInput {
  importType: ImportType;
  sourceSystem: string;
  originalFilename: string;
  fileContents: string;
  // true: schema-validate only, persist the batch + issues for the record,
  // never touch Category/Brand/Product/Variant/InventoryBalance. false:
  // additionally execute every row that passed validation, one
  // `$transaction` per row (see row-processors.ts) — a bad row never rolls
  // back rows already committed before it.
  dryRun: boolean;
}

export interface RunImportResult {
  batch: ImportBatch;
  issues: RowIssue[];
}

function processRow(
  tx: Prisma.TransactionClient,
  importType: ImportType,
  data: unknown,
  batch: ImportBatch,
  actorId: string,
): Promise<void> {
  switch (importType) {
    case "CATEGORIES":
      return processCategoryRow(tx, data as never, batch, actorId);
    case "BRANDS":
      return processBrandRow(tx, data as never, batch, actorId);
    case "PRODUCTS":
      return processProductRow(tx, data as never, batch, actorId);
    case "VARIANTS":
      return processVariantRow(tx, data as never, batch, actorId);
    case "INITIAL_STOCK":
      return processInitialStockRow(tx, data as never, batch, actorId);
  }
}

export async function runImport(input: RunImportInput, actorId: string): Promise<RunImportResult> {
  const fileChecksum = createHash("sha256").update(input.fileContents).digest("hex");

  let batch = await prisma.importBatch.create({
    data: {
      importType: input.importType,
      sourceSystem: input.sourceSystem,
      originalFilename: input.originalFilename,
      fileChecksum,
      status: "VALIDATING",
      createdById: actorId,
    },
  });

  let rows: Record<string, string>[];
  try {
    rows = parseCsv(input.fileContents);
  } catch (error) {
    batch = await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "FAILED" } });
    const message =
      error instanceof CsvParseError ? error.message : "No se pudo leer el archivo CSV.";
    await prisma.importIssue.create({
      data: {
        importBatchId: batch.id,
        rowNumber: 0,
        entityType: input.importType,
        errorCode: "CSV_PARSE_ERROR",
        message,
      },
    });
    return {
      batch,
      issues: [{ rowNumber: 0, errorCode: "CSV_PARSE_ERROR", message, rawRowSnapshot: {} }],
    };
  }

  const { validRows, issues } = validateImportRows(input.importType, rows);

  if (input.dryRun) {
    await persistIssues(batch.id, input.importType, issues);
    batch = await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "READY",
        totalRows: rows.length,
        successfulRows: validRows.length,
        failedRows: issues.length,
      },
    });
    return { batch, issues };
  }

  batch = await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status: "IMPORTING", startedAt: new Date() },
  });

  let successfulRows = 0;
  const executionIssues: RowIssue[] = [...issues];

  for (const row of validRows) {
    try {
      await prisma.$transaction((tx) => processRow(tx, input.importType, row.data, batch, actorId));
      successfulRows += 1;
    } catch (error) {
      if (error instanceof DuplicateOperationError) {
        // Already applied by a prior attempt (same or earlier batch) —
        // idempotent no-op, not a failure. See
        // modules/inventory/idempotency.ts.
        successfulRows += 1;
        executionIssues.push({
          rowNumber: row.rowNumber,
          errorCode: "ALREADY_IMPORTED",
          message: "Esta fila ya había sido importada anteriormente; no se volvió a aplicar.",
          rawRowSnapshot: row.raw,
        });
      } else if (error instanceof ImportRowError) {
        executionIssues.push({
          rowNumber: row.rowNumber,
          errorCode: error.errorCode,
          message: error.message,
          rawRowSnapshot: row.raw,
        });
      } else {
        executionIssues.push({
          rowNumber: row.rowNumber,
          errorCode: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Error desconocido al procesar la fila.",
          rawRowSnapshot: row.raw,
        });
      }
    }
  }

  await persistIssues(batch.id, input.importType, executionIssues);

  const failedRows = executionIssues.filter((i) => i.errorCode !== "ALREADY_IMPORTED").length;

  batch = await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: failedRows > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      completedAt: new Date(),
      totalRows: rows.length,
      successfulRows,
      failedRows,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "import_batch.executed",
    entityType: "ImportBatch",
    entityId: batch.id,
    newValue: { importType: batch.importType, totalRows: rows.length, successfulRows, failedRows },
  });

  return { batch, issues: executionIssues };
}

async function persistIssues(
  batchId: string,
  entityType: string,
  issues: RowIssue[],
): Promise<void> {
  if (issues.length === 0) return;
  await prisma.importIssue.createMany({
    data: issues.map((issue) => ({
      importBatchId: batchId,
      rowNumber: issue.rowNumber,
      entityType,
      field: issue.field ?? null,
      errorCode: issue.errorCode,
      message: issue.message,
      // The raw row is kept for troubleshooting a rejected row, but this
      // phase's CSV columns are never expected to carry secrets/tokens —
      // see modules/imports/row-schemas.ts for the full documented column
      // set. Revisit if a future column ever could.
      rawRowSnapshot: issue.rawRowSnapshot,
    })),
  });
}

export * from "./errors";
