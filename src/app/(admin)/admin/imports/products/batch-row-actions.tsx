"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { cancelImportBatchAction, getImportErrorReportAction } from "./actions";

const CANCELLABLE_STATUSES = new Set(["UPLOADED", "VALIDATING", "READY"]);

function downloadCsv(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BatchRowActions({ batchId, status }: { batchId: string; status: string }) {
  const [isPending, startTransition] = useTransition();

  function handleDownloadReport() {
    startTransition(async () => {
      try {
        const csv = await getImportErrorReportAction({ batchId });
        downloadCsv(`errores-${batchId}.csv`, csv);
      } catch {
        toast.error("No pudimos generar el reporte.");
      }
    });
  }

  function handleCancel() {
    startTransition(async () => {
      try {
        await cancelImportBatchAction({ batchId });
        toast.success("Importación cancelada.");
      } catch {
        toast.error("No pudimos cancelar la importación.");
      }
    });
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={isPending} onClick={handleDownloadReport}>
        Reporte
      </Button>
      {CANCELLABLE_STATUSES.has(status) && (
        <Button variant="ghost" size="sm" disabled={isPending} onClick={handleCancel}>
          Cancelar
        </Button>
      )}
    </div>
  );
}
