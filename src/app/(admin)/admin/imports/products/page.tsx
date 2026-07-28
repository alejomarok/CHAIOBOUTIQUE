import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/modules/auth";
import { listImportBatches } from "@/modules/imports/service";

import { BatchRowActions } from "./batch-row-actions";
import { ImportForm } from "./import-form";

export const metadata = { title: "Importaciones" };

const STATUS_LABELS: Record<string, string> = {
  UPLOADED: "Subido",
  VALIDATING: "Validando",
  READY: "Listo (vista previa)",
  IMPORTING: "Importando",
  COMPLETED: "Completado",
  COMPLETED_WITH_ERRORS: "Completado con errores",
  FAILED: "Falló",
  CANCELLED: "Cancelado",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  UPLOADED: "outline",
  VALIDATING: "secondary",
  READY: "secondary",
  IMPORTING: "secondary",
  COMPLETED: "default",
  COMPLETED_WITH_ERRORS: "destructive",
  FAILED: "destructive",
  CANCELLED: "outline",
};

export default async function ImportProductsPage() {
  const user = await requirePermission("product_imports.view");
  const canExecute = user.permissions.has("product_imports.execute");

  const batches = await listImportBatches();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Importaciones</h1>
        <p className="text-muted-foreground text-sm">
          Cargá categorías, marcas, productos, variantes o stock inicial desde un sistema
          anterior. Cada fila se procesa de forma independiente — una fila con error no afecta a
          las demás. Una fila ya importada antes (mismo archivo o uno corregido) no se vuelve a
          aplicar.
        </p>
      </div>

      {canExecute && <ImportForm />}

      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Archivo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Filas</TableHead>
              <TableHead>Responsable</TableHead>
              {canExecute && <TableHead className="w-32" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.length === 0 && (
              <TableRow>
                <TableCell colSpan={canExecute ? 8 : 7} className="text-muted-foreground text-center">
                  Todavía no se cargó ninguna importación.
                </TableCell>
              </TableRow>
            )}
            {batches.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell className="text-muted-foreground text-xs">
                  {batch.createdAt.toLocaleString("es-AR")}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{batch.importType}</Badge>
                </TableCell>
                <TableCell className="text-xs">{batch.sourceSystem}</TableCell>
                <TableCell className="max-w-48 truncate text-xs" title={batch.originalFilename}>
                  {batch.originalFilename}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANTS[batch.status] ?? "outline"}>
                    {STATUS_LABELS[batch.status] ?? batch.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {batch.successfulRows}/{batch.totalRows}
                  {batch.failedRows > 0 && (
                    <span className="text-destructive ml-1">({batch.failedRows} con error)</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {batch.createdBy.name}
                </TableCell>
                {canExecute && (
                  <TableCell>
                    <BatchRowActions batchId={batch.id} status={batch.status} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
