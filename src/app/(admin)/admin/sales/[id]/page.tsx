import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { minorUnitsToDisplay } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import { getSystemDefaultCustomer, listCustomers } from "@/modules/customers/customer";
import { getCustomerDisplayName } from "@/modules/customers/normalize";
import { getSaleById } from "@/modules/sales/sale";
import { listWarehouses } from "@/modules/warehouses/service";
import type { SaleStatus } from "@/generated/prisma/client";

import { SaleForm } from "../sale-form";
import { CancelSaleButton } from "./cancel-sale-button";

export const metadata = { title: "Detalle de venta" };

const STATUS_LABELS_ES: Record<SaleStatus, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
};

const STATUS_BADGE_VARIANT: Record<SaleStatus, "default" | "outline" | "secondary"> = {
  DRAFT: "outline",
  CONFIRMED: "default",
  CANCELLED: "secondary",
};

// Same "$ 1.500,50" -> "1.500,50" strip used by sale-form.tsx and the
// existing product edit page — no separate "minor units to bare editable
// string" export exists in lib/money.ts.
function toEditableAmount(amount: bigint): string {
  return minorUnitsToDisplay(amount).replace(/[^\d,.-]/g, "");
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const canManage = user.permissions.has("sales.create");
  const canCancel = user.permissions.has("sales.cancel");
  const canSelectWarehouse = user.permissions.has("warehouses.view");
  const canViewMovements = user.permissions.has("stock.view_movements");
  const { id } = await params;

  const sale = await getSaleById(id);
  if (!sale) notFound();

  // A draft is edited in-place with the exact same form used to create a
  // sale — the whole point of a DRAFT status is that it's still a working
  // document, not a read-only record yet.
  if (sale.status === "DRAFT" && canManage) {
    const [{ customers }, consumidorFinal, allWarehouses] = await Promise.all([
      listCustomers({ status: "active", take: 200 }),
      getSystemDefaultCustomer(),
      canSelectWarehouse ? listWarehouses() : Promise.resolve([]),
    ]);
    const activeWarehouses = allWarehouses.filter((w) => w.isActive);

    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{sale.code}</h1>
            <Badge variant={STATUS_BADGE_VARIANT[sale.status]}>{STATUS_LABELS_ES[sale.status]}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Esta venta todavía es un borrador — podés seguir editándola.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <SaleForm
              saleId={sale.id}
              customers={customers.map((c) => ({
                id: c.id,
                displayName: getCustomerDisplayName(c),
                isSystemDefault: c.isSystemDefault,
              }))}
              defaultCustomerId={consumidorFinal?.id ?? sale.customerId}
              canApplyDiscount={user.permissions.has("sales.apply_discount")}
              warehouses={activeWarehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
              defaultWarehouseId={sale.warehouseId}
              canSelectWarehouse={canSelectWarehouse}
              defaultValues={{
                customerId: sale.customerId,
                warehouseId: sale.warehouseId,
                notes: sale.notes ?? "",
                items: sale.items.map((item) => ({
                  productVariantId: item.productVariantId,
                  displayName: item.productNameSnapshot,
                  sku: item.skuSnapshot,
                  quantity: String(item.quantity),
                  unitPriceAmount: toEditableAmount(item.unitPriceAmount),
                  discountAmount: item.discountAmount > 0n ? toEditableAmount(item.discountAmount) : "",
                })),
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // CONFIRMED or CANCELLED (or DRAFT without manage permission): read-only.
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{sale.code}</h1>
            <Badge variant={STATUS_BADGE_VARIANT[sale.status]}>{STATUS_LABELS_ES[sale.status]}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {new Date(sale.saleDate).toLocaleString("es-AR")}
          </p>
          <p className="mt-1 text-sm font-medium">Depósito: {sale.warehouse.name}</p>
          {sale.status === "CONFIRMED" && <p className="text-sm">Stock descontado: Sí</p>}
          {(sale.status === "CONFIRMED" || sale.status === "CANCELLED") && canViewMovements && (
            <p className="text-sm">
              <Link
                href={`/admin/inventory/movements?relatedEntityType=Sale&relatedEntityId=${sale.id}`}
                className="underline"
              >
                Ver movimientos de stock
              </Link>
            </p>
          )}
        </div>
        {canCancel && sale.status !== "CANCELLED" && <CancelSaleButton saleId={sale.id} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">Nombre</p>
            <p>{sale.customerNameSnapshot}</p>
          </div>
          {sale.customerDocumentSnapshot && (
            <div>
              <p className="text-muted-foreground text-xs">Documento</p>
              <p>{sale.customerDocumentSnapshot}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Precio unitario</TableHead>
                  <TableHead>Descuento</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sale.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.productNameSnapshot}</TableCell>
                    <TableCell className="font-mono text-xs">{item.skuSnapshot}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{minorUnitsToDisplay(item.unitPriceAmount)}</TableCell>
                    <TableCell>{minorUnitsToDisplay(item.discountAmount)}</TableCell>
                    <TableCell>{minorUnitsToDisplay(item.totalAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Totales</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{minorUnitsToDisplay(sale.subtotalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Descuentos</span>
            <span>-{minorUnitsToDisplay(sale.discountTotalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Impuestos</span>
            <span>{minorUnitsToDisplay(sale.taxTotalAmount)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{minorUnitsToDisplay(sale.totalAmount)}</span>
          </div>
        </CardContent>
      </Card>

      {sale.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{sale.notes}</p>
          </CardContent>
        </Card>
      )}

      {sale.status === "CANCELLED" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle>Cancelación</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Cancelada {sale.cancelledAt && new Date(sale.cancelledAt).toLocaleString("es-AR")}</p>
            {sale.cancelledBy && <p>Por {sale.cancelledBy.name}</p>}
            {sale.cancelReason && <p>Motivo: {sale.cancelReason}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
