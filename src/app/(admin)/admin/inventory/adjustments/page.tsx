import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePermission } from "@/modules/auth";
import { prisma } from "@/lib/db";
import { listWarehouses } from "@/modules/warehouses/service";

import { AdjustmentForm } from "./adjustment-form";
import { TransferForm } from "./transfer-form";

export const metadata = { title: "Ajuste de inventario" };

export default async function InventoryAdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ variantId?: string; warehouseId?: string }>;
}) {
  const user = await requirePermission("stock.adjust");
  const canTransfer = user.permissions.has("stock.transfer");
  const { variantId, warehouseId } = await searchParams;

  const [variants, warehouses] = await Promise.all([
    prisma.productVariant.findMany({
      where: { isActive: true },
      include: { product: true, sizeOption: true, color: true },
      orderBy: { sku: "asc" },
      take: 500,
    }),
    listWarehouses(),
  ]);

  const variantOptions = variants.map((variant) => ({
    id: variant.id,
    label: `${variant.product.name} — ${
      [variant.sizeOption?.label, variant.color?.displayName].filter(Boolean).join(" / ") ||
      variant.sku
    }`,
  }));
  const warehouseOptions = warehouses.map((warehouse) => ({
    id: warehouse.id,
    name: warehouse.name,
  }));

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Ajuste de inventario</h1>
        <p className="text-muted-foreground text-sm">
          Todo movimiento requiere un motivo y queda auditado.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          {canTransfer ? (
            <Tabs defaultValue="adjustment">
              <TabsList>
                <TabsTrigger value="adjustment">Ajuste</TabsTrigger>
                <TabsTrigger value="transfer">Transferencia</TabsTrigger>
              </TabsList>
              <TabsContent value="adjustment" className="pt-4">
                <AdjustmentForm
                  variants={variantOptions}
                  warehouses={warehouseOptions}
                  defaultVariantId={variantId}
                  defaultWarehouseId={warehouseId}
                />
              </TabsContent>
              <TabsContent value="transfer" className="pt-4">
                <TransferForm variants={variantOptions} warehouses={warehouseOptions} />
              </TabsContent>
            </Tabs>
          ) : (
            <AdjustmentForm
              variants={variantOptions}
              warehouses={warehouseOptions}
              defaultVariantId={variantId}
              defaultWarehouseId={warehouseId}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
