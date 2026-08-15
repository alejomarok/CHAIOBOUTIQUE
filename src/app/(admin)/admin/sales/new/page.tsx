import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { getSystemDefaultCustomer, listCustomers } from "@/modules/customers/customer";
import { getCustomerDisplayName } from "@/modules/customers/normalize";
import { listWarehouses } from "@/modules/warehouses/service";

import { SaleForm } from "../sale-form";

export const metadata = { title: "Nueva venta" };

export default async function NewSalePage() {
  const user = await requirePermission("sales.create");
  // Only actors who can see the warehouse catalog get to pick a
  // non-default one — everyone else's sales silently use the system
  // default warehouse (see sale-core.ts's resolveWarehouseId).
  const canSelectWarehouse = user.permissions.has("warehouses.view");

  const [{ customers }, consumidorFinal, allWarehouses] = await Promise.all([
    listCustomers({ status: "active", take: 200 }),
    getSystemDefaultCustomer(),
    canSelectWarehouse ? listWarehouses() : Promise.resolve([]),
  ]);
  const activeWarehouses = allWarehouses.filter((w) => w.isActive);
  const defaultWarehouseId = allWarehouses.find((w) => w.isDefault)?.id ?? "";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Nueva venta</h1>
        <p className="text-muted-foreground text-sm">
          Elegí un cliente (o usá Consumidor Final para una venta sin identificar), agregá
          productos y guardá como borrador o confirmá directamente.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <SaleForm
            customers={customers.map((c) => ({
              id: c.id,
              displayName: getCustomerDisplayName(c),
              isSystemDefault: c.isSystemDefault,
            }))}
            defaultCustomerId={consumidorFinal?.id ?? ""}
            canApplyDiscount={user.permissions.has("sales.apply_discount")}
            warehouses={activeWarehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
            defaultWarehouseId={defaultWarehouseId}
            canSelectWarehouse={canSelectWarehouse}
          />
        </CardContent>
      </Card>
    </div>
  );
}
