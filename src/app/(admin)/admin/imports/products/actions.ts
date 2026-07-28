"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { cancelImportBatch, getImportBatchById, runImport } from "@/modules/imports/service";
import { buildImportErrorReportCsv, generateImportTemplateCsv } from "@/modules/imports/templates";
import type { ImportType } from "@/generated/prisma/client";

const IMPORT_TYPES = ["CATEGORIES", "BRANDS", "PRODUCTS", "VARIANTS", "INITIAL_STOCK"] as const satisfies readonly ImportType[];

const runImportFormSchema = z.object({
  importType: z.enum(IMPORT_TYPES),
  sourceSystem: z.string().trim().min(1, "Indicá el sistema de origen."),
});

async function parseRunImportForm(formData: FormData) {
  const parsed = runImportFormSchema.parse({
    importType: formData.get("importType"),
    sourceSystem: formData.get("sourceSystem"),
  });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No se recibió ningún archivo.");
  }

  return {
    importType: parsed.importType,
    sourceSystem: parsed.sourceSystem,
    originalFilename: file.name,
    fileContents: await file.text(),
  };
}

function serializeIssues(issues: { rowNumber: number; field?: string; errorCode: string; message: string }[]) {
  return issues.map((issue) => ({
    rowNumber: issue.rowNumber,
    field: issue.field ?? null,
    errorCode: issue.errorCode,
    message: issue.message,
  }));
}

// Dry run — schema-validates every row and persists the batch + issues for
// the record, but never touches Category/Brand/Product/Variant/
// InventoryBalance. The admin reviews this summary before choosing to
// execute the same file for real.
export async function previewImportAction(formData: FormData) {
  const actor = await requirePermission("product_imports.execute");
  const input = await parseRunImportForm(formData);
  const result = await runImport({ ...input, dryRun: true }, actor.id);
  revalidatePath("/admin/imports/products");
  return { batch: result.batch, issues: serializeIssues(result.issues) };
}

// Executes the same file for real — one $transaction per row, partial
// failures don't roll back rows already committed. See
// modules/imports/service.ts.
export async function executeImportAction(formData: FormData) {
  const actor = await requirePermission("product_imports.execute");
  const input = await parseRunImportForm(formData);
  const result = await runImport({ ...input, dryRun: false }, actor.id);
  revalidatePath("/admin/imports/products");
  return { batch: result.batch, issues: serializeIssues(result.issues) };
}

export async function cancelImportBatchAction(input: { batchId: string }) {
  const actor = await requirePermission("product_imports.execute");
  await cancelImportBatch(input.batchId, actor.id);
  revalidatePath("/admin/imports/products");
}

export async function getImportTemplateAction(input: { importType: ImportType }) {
  await requirePermission("product_imports.view");
  return generateImportTemplateCsv(input.importType);
}

export async function getImportErrorReportAction(input: { batchId: string }) {
  await requirePermission("product_imports.view");
  const batch = await getImportBatchById(input.batchId);
  if (!batch) throw new Error("Importación no encontrada.");
  return buildImportErrorReportCsv(
    batch.issues.map((issue) => ({
      rowNumber: issue.rowNumber,
      field: issue.field ?? undefined,
      errorCode: issue.errorCode,
      message: issue.message,
    })),
  );
}
