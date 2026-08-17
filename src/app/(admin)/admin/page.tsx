import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/modules/auth";
import { listCustomers } from "@/modules/customers/customer";
import { getStockByVariantIds } from "@/modules/inventory/service";
import { computeProductListStatus } from "@/modules/products/list-status";
import { listProducts } from "@/modules/products/service";
import { listSales } from "@/modules/sales/sale";
import { minorUnitsToDisplay } from "@/lib/money";
import type { SaleStatus } from "@/generated/prisma/client";

export const metadata = { title: "Panel" };

const SALE_STATUS_LABEL_ES: Record<SaleStatus, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
};
const SALE_STATUS_BADGE: Record<SaleStatus, "default" | "outline" | "secondary"> = {
  DRAFT: "outline",
  CONFIRMED: "default",
  CANCELLED: "secondary",
};

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const canViewProducts = user.permissions.has("products.view");
  const canViewCustomers = user.permissions.has("customers.view");
  const canViewSales = user.permissions.has("sales.view");

  // Every card below reads a real, already-existing service function —
  // never a placeholder or invented figure. A card is only fetched (and
  // only rendered) when the current user actually has permission to see
  // that data, same server-side gate every /admin/* page itself uses.
  const [productStats, customerTotal, recentSales] = await Promise.all([
    canViewProducts ? loadProductStats() : null,
    canViewCustomers ? listCustomers({ take: 1 }).then((r) => r.total) : null,
    canViewSales ? listSales({ take: 5 }) : null,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Panel</h1>
        <p className="text-muted-foreground text-sm">Bienvenida, {user.name}.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {productStats && (
          <>
            <SummaryCard label="Productos" value={productStats.total} href="/admin/products" />
            <SummaryCard
              label="Publicados"
              value={productStats.published}
              href="/admin/products"
            />
            <SummaryCard
              label="Sin stock / bajo"
              value={productStats.outOfStock}
              href="/admin/products"
            />
          </>
        )}
        {customerTotal !== null && (
          <SummaryCard label="Clientes" value={customerTotal} href="/admin/customers" />
        )}
      </div>

      {recentSales && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle>Ventas recientes</CardTitle>
            <Link href="/admin/sales" className="text-primary text-sm font-medium hover:underline">
              Ver todas
            </Link>
          </CardHeader>
          <CardContent>
            {recentSales.sales.length === 0 ? (
              <p className="text-muted-foreground text-sm">Todavía no hay ventas registradas.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {recentSales.sales.map((sale) => (
                  <li key={sale.id}>
                    <Link
                      href={`/admin/sales/${sale.id}`}
                      className="hover:bg-accent -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{sale.code}</span>
                        <span className="text-muted-foreground">{sale.customerNameSnapshot}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">
                          {minorUnitsToDisplay(sale.totalAmount)}
                        </span>
                        <Badge variant={SALE_STATUS_BADGE[sale.status]}>
                          {SALE_STATUS_LABEL_ES[sale.status]}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!canViewProducts && !canViewCustomers && !canViewSales && (
        <p className="text-muted-foreground text-sm">
          Tu rol no tiene permisos para ver métricas del panel todavía.
        </p>
      )}
    </div>
  );
}

async function loadProductStats() {
  const products = await listProducts();
  const allVariantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const stockByVariantId = await getStockByVariantIds(allVariantIds);

  let published = 0;
  let outOfStock = 0;
  for (const product of products) {
    const totalStock = product.variants.reduce(
      (sum, v) => sum + (stockByVariantId.get(v.id) ?? 0),
      0,
    );
    const { status } = computeProductListStatus(product, product.variants, totalStock);
    if (status === "PUBLISHED") published++;
    if (status === "OUT_OF_STOCK") outOfStock++;
  }

  return { total: products.length, published, outOfStock };
}

function SummaryCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href}>
      <Card className="ring-border/60 shadow-none ring-1 transition-colors hover:bg-accent">
        <CardHeader>
          <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-heading text-3xl font-semibold">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
