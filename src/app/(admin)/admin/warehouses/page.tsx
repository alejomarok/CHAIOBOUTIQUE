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
import { listWarehouses } from "@/modules/warehouses/service";

import { CreateWarehouseDialog } from "./create-warehouse-dialog";
import { WarehouseRowActions } from "./warehouse-row-actions";

export const metadata = { title: "Depósitos" };

export default async function WarehousesPage() {
  const user = await requirePermission("warehouses.view");
  const canManage = user.permissions.has("warehouses.manage");

  const warehouses = await listWarehouses();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Depósitos</h1>
          <p className="text-muted-foreground text-sm">
            El depósito predeterminado es también el que se usa para la disponibilidad online.
          </p>
        </div>
        {canManage && <CreateWarehouseDialog />}
      </div>
      {warehouses.length === 0 && (
        <div className="border-destructive/40 bg-destructive/5 rounded-xl border p-4">
          <p className="font-medium">Todavía no hay depósitos.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Sin un depósito, el stock no se puede mostrar ni cargar en ningún producto.
            {canManage
              ? " Creá el primero para empezar a cargar stock."
              : " Pedile a un administrador que cree uno."}
          </p>
        </div>
      )}
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              {canManage && <TableHead className="w-48" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {warehouses.map((warehouse) => (
              <TableRow key={warehouse.id}>
                <TableCell className="font-mono text-xs">{warehouse.code}</TableCell>
                <TableCell className="font-medium">
                  {warehouse.name}
                  {warehouse.isDefault && (
                    <Badge variant="secondary" className="ml-2">
                      Predeterminado
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={warehouse.isActive ? "default" : "outline"}>
                    {warehouse.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell>
                    <WarehouseRowActions
                      id={warehouse.id}
                      isDefault={warehouse.isDefault}
                      isActive={warehouse.isActive}
                    />
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
