"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportType } from "@/generated/prisma/client";

import { executeImportAction, getImportTemplateAction, previewImportAction } from "./actions";

const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  CATEGORIES: "Categorías",
  BRANDS: "Marcas",
  PRODUCTS: "Productos",
  VARIANTS: "Variantes",
  INITIAL_STOCK: "Stock inicial",
};

interface RunResult {
  batch: {
    id: string;
    status: string;
    totalRows: number;
    successfulRows: number;
    failedRows: number;
  };
  issues: { rowNumber: number; field: string | null; errorCode: string; message: string }[];
}

function downloadCsv(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Preview and execute both read from the same <form> element via FormData —
// the file input isn't cleared between the two, so "Confirmar e importar"
// resubmits the exact same bytes the preview just validated. No file is
// ever persisted server-side between the two steps; each call is a
// self-contained, independent parse+validate(+execute) — see
// modules/imports/service.ts.
export function ImportForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [importType, setImportType] = useState<ImportType>("PRODUCTS");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RunResult | null>(null);

  function handleDownloadTemplate() {
    startTransition(async () => {
      try {
        const csv = await getImportTemplateAction({ importType });
        downloadCsv(`plantilla-${importType.toLowerCase()}.csv`, csv);
      } catch {
        toast.error("No pudimos generar la plantilla.");
      }
    });
  }

  function handlePreview() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(async () => {
      try {
        const preview = await previewImportAction(formData);
        setResult(preview);
        if (preview.batch.status === "FAILED") {
          toast.error("No pudimos leer el archivo.");
        } else {
          toast.success(
            `Vista previa lista: ${preview.batch.successfulRows} de ${preview.batch.totalRows} filas válidas.`,
          );
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos validar el archivo.");
      }
    });
  }

  function handleExecute() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(async () => {
      try {
        const executed = await executeImportAction(formData);
        setResult(executed);
        toast.success(
          `Importación completada: ${executed.batch.successfulRows}/${executed.batch.totalRows} filas.`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No pudimos ejecutar la importación.");
      }
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <form ref={formRef} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Tipo de importación</Label>
              <input type="hidden" name="importType" value={importType} />
              <Select
                value={importType}
                onValueChange={(value) => {
                  setImportType(value as ImportType);
                  setResult(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(IMPORT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sourceSystem">Sistema de origen</Label>
              <Input
                id="sourceSystem"
                name="sourceSystem"
                placeholder="ej: sistema-anterior"
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file">Archivo CSV</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              onChange={() => setResult(null)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={handleDownloadTemplate}>
              Descargar plantilla
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={handlePreview}>
              Vista previa
            </Button>
            <Button
              type="button"
              disabled={isPending || !result || result.batch.status !== "READY"}
              onClick={handleExecute}
            >
              Confirmar e importar
            </Button>
          </div>
        </form>

        {result && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {result.batch.successfulRows} de {result.batch.totalRows} filas válidas
              {result.batch.failedRows > 0 && (
                <span className="text-destructive"> — {result.batch.failedRows} con error</span>
              )}
            </p>
            {result.issues.length > 0 && (
              <div className="border-border max-h-80 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fila</TableHead>
                      <TableHead>Campo</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>Mensaje</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.issues.slice(0, 100).map((issue, index) => (
                      <TableRow key={index}>
                        <TableCell>{issue.rowNumber}</TableCell>
                        <TableCell className="text-xs">{issue.field ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={issue.errorCode === "ALREADY_IMPORTED" ? "secondary" : "destructive"}
                          >
                            {issue.errorCode}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{issue.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
