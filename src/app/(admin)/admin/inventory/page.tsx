import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/modules/auth";
import { listInventoryBalances } from "@/modules/inventory/service";

export const metadata = { title: "Inventario" };

export default async function InventoryPage() {
  const user = await requirePermission("stock.view");
  const canAdjust = user.permissions.has("stock.adjust");

  const balances = await listInventoryBalances();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Inventario</h1>
          <p className="text-muted-foreground text-sm">Stock actual por variante y depósito.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/inventory/movements">Ver movimientos</Link>
          </Button>
          {canAdjust && (
            <Button asChild>
              <Link href="/admin/inventory/adjustments">Nuevo ajuste</Link>
            </Button>
          )}
        </div>
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Talle / Color</TableHead>
              <TableHead>Depósito</TableHead>
              <TableHead>Cantidad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.map((balance) => (
              <TableRow key={balance.id}>
                <TableCell className="font-medium">{balance.variant.product.name}</TableCell>
                <TableCell className="font-mono text-xs">{balance.variant.sku}</TableCell>
                <TableCell>
                  {[balance.variant.size?.displayName, balance.variant.color?.displayName]
                    .filter(Boolean)
                    .join(" / ") || "—"}
                </TableCell>
                <TableCell>{balance.warehouse.name}</TableCell>
                <TableCell>
                  <Badge variant={balance.quantity > 0 ? "default" : "outline"}>
                    {balance.quantity}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
