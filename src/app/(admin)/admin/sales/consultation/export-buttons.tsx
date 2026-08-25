"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { exportSalesReportCsvAction, exportSalesReportDetailCsvAction } from "./actions";
import type { SalesConsultationSearchParams } from "./search-params";

// Downloads happen entirely client-side (Blob + a transient <a download>),
// never a page navigation — the Server Action only returns plain CSV text
// (bounded, see actions.ts's EXPORT_ROW_LIMIT), never a stream. filters are
// the CURRENT, already-validated page filters (passed down from the Server
// Component as plain strings) — never re-read from window.location, so the
// export always matches exactly what's on screen.
function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ExportButtons({ filters }: { filters: SalesConsultationSearchParams }) {
  const [isExporting, setIsExporting] = useState<"summary" | "detail" | null>(null);

  async function handleExport(kind: "summary" | "detail") {
    setIsExporting(kind);
    try {
      const { filename, csv } =
        kind === "summary" ? await exportSalesReportCsvAction(filters) : await exportSalesReportDetailCsvAction(filters);
      downloadCsv(filename, csv);
    } catch {
      toast.error("No pudimos generar la exportación. Intentá de nuevo.");
    } finally {
      setIsExporting(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isExporting !== null}
        onClick={() => handleExport("summary")}
      >
        {isExporting === "summary" ? "Exportando…" : "Exportar CSV"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isExporting !== null}
        onClick={() => handleExport("detail")}
      >
        {isExporting === "detail" ? "Exportando…" : "Exportar detalle"}
      </Button>
    </div>
  );
}
