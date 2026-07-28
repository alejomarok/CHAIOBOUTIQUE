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
import { prisma } from "@/lib/db";

export const metadata = { title: "Movimientos de stock" };

export default async function InventoryMovementsPage() {
  await requirePermission("stock.view_movements");

  const movements = await prisma.inventoryMovement.findMany({
    include: {
      variant: { include: { product: true, size: true, color: true } },
      warehouse: true,
      operation: { include: { actor: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Movimientos de stock</h1>
        <p className="text-muted-foreground text-sm">
          Historial inmutable — las correcciones se hacen con movimientos compensatorios, nunca
          editando uno existente.
        </p>
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Depósito</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cantidad</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead>Responsable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell className="text-muted-foreground text-xs">
                  {movement.createdAt.toLocaleString("es-AR")}
                </TableCell>
                <TableCell className="font-medium">
                  {movement.variant.product.name}
                  <span className="text-muted-foreground ml-1 text-xs">
                    (
                    {[movement.variant.size?.displayName, movement.variant.color?.displayName]
                      .filter(Boolean)
                      .join(" / ") || movement.variant.sku}
                    )
                  </span>
                </TableCell>
                <TableCell>{movement.warehouse.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{movement.movementType}</Badge>
                </TableCell>
                <TableCell className={movement.quantityDelta < 0 ? "text-destructive" : ""}>
                  {movement.quantityDelta > 0 ? "+" : ""}
                  {movement.quantityDelta}
                </TableCell>
                <TableCell>{movement.newQuantity}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {movement.operation.actor.name}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
