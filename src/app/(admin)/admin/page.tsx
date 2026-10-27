import { ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";

import { AdminRefreshButton } from "@/components/layout/admin-refresh-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { minorUnitsToDisplay } from "@/lib/money";
import { getCurrentUser } from "@/modules/auth";
import { listCustomers } from "@/modules/customers/customer";
import { getStockByVariantIds } from "@/modules/inventory/service";
import { listOrders } from "@/modules/orders/order";
import { computeProductListStatus } from "@/modules/products/list-status";
import { listProducts } from "@/modules/products/service";
import { listSales } from "@/modules/sales/sale";
import type { SaleStatus } from "@/generated/prisma/client";

export const metadata = { title: "Vista general" };

const SALE_STATUS: Record<SaleStatus, { label: string; className: string }> = {
  DRAFT: { label: "Borrador", className: "bg-[#f0f0eb] text-[#626962]" },
  CONFIRMED: { label: "Confirmada", className: "bg-[#eaf0e8] text-[#34483d]" },
  CANCELLED: { label: "Cancelada", className: "bg-[#f4eeeb] text-[#775348]" },
};

const countFormat = new Intl.NumberFormat("es-AR");
const dateFormat = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

// Screen question: what needs attention in the boutique, and what is its activity?
// Achromatic ledger, seed 1798749090. Face: the boutique's ivory ground and
// original bird mark. Signature: publication readiness and replenishment.
// Data: real products and their variants/stock, customer/sale/order totals.
// All reads and actions retain their own permissions. There is no sample data.
// At 1440px, 244 sidebar + 64 gutters + 24 gap + 712 activity + 396
// catalog = 1440. Both panels share the divided metric strip's outer edges.
export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const canViewProducts = user.permissions.has("products.view");
  const canViewCustomers = user.permissions.has("customers.view");
  const canViewSales = user.permissions.has("sales.view");
  const canViewOrders = user.permissions.has("orders.view");
  const canCreateSale = user.permissions.has("sales.create");
  const canCreateProduct = user.permissions.has("products.create");

  const [productsResult, customersResult, salesResult, ordersResult] = await Promise.allSettled([
    canViewProducts ? loadProductStats() : null,
    canViewCustomers ? listCustomers({ take: 1 }).then((result) => result.total) : null,
    canViewSales ? listSales({ take: 5 }) : null,
    canViewOrders ? listOrders({ take: 1 }).then((result) => result.total) : null,
  ]);

  const productStats = productsResult.status === "fulfilled" ? productsResult.value : null;
  const customerTotal = customersResult.status === "fulfilled" ? customersResult.value : null;
  const recentSales = salesResult.status === "fulfilled" ? salesResult.value : null;
  const orderTotal = ordersResult.status === "fulfilled" ? ordersResult.value : null;
  const hasLoadError = [productsResult, customersResult, salesResult, ordersResult].some(
    (result) => result.status === "rejected",
  );

  const metrics = [
    ...(canViewProducts
      ? [
          {
            label: "Productos",
            value: productStats?.total ?? null,
            href: "/admin/products",
            detail: "En el catálogo",
          },
        ]
      : []),
    ...(canViewOrders
      ? [
          {
            label: "Pedidos online",
            value: orderTotal,
            href: "/admin/orders",
            detail: "Historial de la tienda",
          },
        ]
      : []),
    ...(canViewSales
      ? [
          {
            label: "Ventas",
            value: recentSales?.total ?? null,
            href: "/admin/sales",
            detail: "Todos los estados",
          },
        ]
      : []),
    ...(canViewCustomers
      ? [
          {
            label: "Clientes",
            value: customerTotal,
            href: "/admin/customers",
            detail: "Agenda de la boutique",
          },
        ]
      : []),
  ];

  const shortcuts = [
    ...(canViewProducts
      ? [
          {
            label: "Gestionar catálogo",
            description: "Prendas, precios y variantes",
            href: "/admin/products",
          },
        ]
      : []),
    ...(canViewOrders
      ? [
          {
            label: "Preparar pedidos",
            description: "Compras de la tienda online",
            href: "/admin/orders",
          },
        ]
      : []),
    ...(user.permissions.has("stock.view")
      ? [
          {
            label: "Revisar inventario",
            description: "Stock por talle y color",
            href: "/admin/inventory",
          },
        ]
      : []),
    ...(canViewCustomers
      ? [
          {
            label: "Ver clientes",
            description: "Contactos e historial de compras",
            href: "/admin/customers",
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <p className="text-muted-foreground mb-2 text-xs">Tu boutique</p>
          <h1 className="font-heading text-[30px] leading-tight font-normal tracking-[-0.02em]">
            Vista general
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {productStats && productStats.outOfStock > 0
              ? `${countFormat.format(productStats.outOfStock)} ${productStats.outOfStock === 1 ? "producto publicado necesita" : "productos publicados necesitan"} reposición.`
              : "Catálogo, pedidos y ventas, en un mismo lugar."}
          </p>
          {productStats && productStats.outOfStock > 0 && (
            <Link
              href="/admin/products"
              className="mt-1 inline-flex min-h-10 items-center gap-2 text-xs font-medium hover:underline"
            >
              Revisar productos <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminRefreshButton />
          {(canCreateSale || canCreateProduct) && (
            <Button asChild className="h-10 gap-2 rounded-md px-4 text-sm font-medium">
              <Link href={canCreateSale ? "/admin/sales/new" : "/admin/products/new"}>
                <Plus className="size-4" aria-hidden="true" />
                {canCreateSale ? "Nueva venta" : "Nuevo producto"}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {hasLoadError && (
        <p
          role="status"
          className="border-border text-muted-foreground rounded-md border bg-white px-4 py-3 text-sm"
        >
          Algunos datos no se pudieron cargar. Usá Actualizar para volver a intentarlo.
        </p>
      )}

      {metrics.length > 0 && (
        <div
          className={cn(
            "border-border bg-border grid gap-px overflow-hidden rounded-lg border",
            metrics.length === 1 ? "grid-cols-1" : "grid-cols-2",
            metrics.length === 3 && "lg:grid-cols-3",
            metrics.length === 4 && "lg:grid-cols-4",
          )}
        >
          {metrics.map((metric, index) => (
            <Link
              key={metric.label}
              href={metric.href}
              className={cn(
                "group focus-visible:ring-ring bg-white px-5 py-5 transition-colors outline-none hover:bg-[#fafbf8] focus-visible:ring-2 focus-visible:ring-inset",
                metrics.length === 3 && index === 2 && "col-span-2 lg:col-span-1",
              )}
            >
              <span className="text-muted-foreground flex items-center justify-between gap-3 text-sm">
                {metric.label}
                <ArrowUpRight
                  className="text-muted-foreground size-3.5 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none"
                  aria-hidden="true"
                />
              </span>
              <p className="mt-3 text-[30px] leading-none font-normal tabular-nums">
                {metric.value === null ? (
                  <span className="text-muted-foreground text-base" aria-label="No disponible">
                    —
                  </span>
                ) : (
                  countFormat.format(metric.value)
                )}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">{metric.detail}</p>
            </Link>
          ))}
        </div>
      )}

      {(canViewSales || canViewProducts) && (
        <div
          className={cn(
            "grid items-start gap-6",
            canViewSales && canViewProducts && "xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]",
          )}
        >
          {canViewSales && (
            <section
              className="border-border overflow-hidden rounded-lg border bg-white"
              aria-labelledby="recent-sales-title"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
                <div>
                  <h2 id="recent-sales-title" className="text-base font-medium">
                    Últimas ventas
                  </h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    La actividad más reciente de mostrador.
                  </p>
                </div>
                <Link
                  href="/admin/sales"
                  className="inline-flex min-h-10 items-center gap-2 text-xs font-medium hover:underline"
                >
                  Ver todas <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
              {recentSales && recentSales.sales.length > 0 ? (
                <>
                  <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_90px_120px] gap-4 px-5 pb-3 text-xs sm:grid">
                    <span>Venta / cliente</span>
                    <span>Estado</span>
                    <span className="text-right">Importe (ARS)</span>
                  </div>
                  <ul>
                    {recentSales.sales.map((sale) => (
                      <li key={sale.id} className="border-t border-[#eef0e9]">
                        <Link
                          href={`/admin/sales/${sale.id}`}
                          className="focus-visible:ring-ring grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 transition-colors outline-none hover:bg-[#fafbf8] focus-visible:ring-2 focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_90px_120px]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {sale.customerNameSnapshot || "Venta de mostrador"}
                            </span>
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {sale.code} · {dateFormat.format(sale.createdAt)}
                            </span>
                            <span
                              className={cn(
                                "mt-2 inline-flex shrink-0 rounded px-2 py-0.5 text-[11px] whitespace-nowrap sm:hidden",
                                SALE_STATUS[sale.status].className,
                              )}
                            >
                              {SALE_STATUS[sale.status].label}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "hidden w-fit shrink-0 rounded px-2 py-1 text-[11px] whitespace-nowrap sm:inline-flex",
                              SALE_STATUS[sale.status].className,
                            )}
                          >
                            {SALE_STATUS[sale.status].label}
                          </span>
                          <span className="text-right text-sm font-medium whitespace-nowrap tabular-nums">
                            {minorUnitsToDisplay(sale.totalAmount)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="border-t border-[#eef0e9] px-5 py-9">
                  <p className="text-sm font-medium">
                    {recentSales
                      ? "Tu próxima venta empieza acá."
                      : "Las ventas no están disponibles."}
                  </p>
                  <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-6">
                    {recentSales
                      ? "Cuando registres una venta, vas a encontrar su detalle y estado en este espacio."
                      : "Actualizá el panel para volver a cargar esta sección."}
                  </p>
                  {recentSales && canCreateSale && (
                    <Link
                      href="/admin/sales/new"
                      className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-medium hover:underline"
                    >
                      Registrar una venta <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              )}
            </section>
          )}

          {canViewProducts && (
            <section
              className="border-border overflow-hidden rounded-lg border bg-white"
              aria-labelledby="catalog-status-title"
            >
              <div className="px-5 pt-5 pb-4">
                <h2 id="catalog-status-title" className="text-base font-medium">
                  Tu catálogo
                </h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  De la selección a la vidriera online.
                </p>
              </div>
              {productStats ? (
                <>
                  <dl className="px-5">
                    {[
                      { label: "En tienda", value: productStats.published, color: "bg-[#34483d]" },
                      {
                        label: "Listos para publicar",
                        value: productStats.ready,
                        color: "bg-[#929f91]",
                      },
                      {
                        label: "Por completar",
                        value: productStats.incomplete,
                        color: "bg-[#c6ccc2]",
                      },
                      {
                        label: "Requieren revisión",
                        value: productStats.blocked,
                        color: "bg-[#dedfd7]",
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between gap-3 border-t border-[#eef0e9] py-3 text-sm"
                      >
                        <dt className="text-muted-foreground flex items-center gap-2.5">
                          <span
                            className={cn("size-1.5 rounded-full", row.color)}
                            aria-hidden="true"
                          />
                          {row.label}
                        </dt>
                        <dd className="text-right tabular-nums">{countFormat.format(row.value)}</dd>
                      </div>
                    ))}
                  </dl>
                  {productStats.total === 0 && (
                    <p className="text-muted-foreground px-5 pt-1 pb-3 text-xs leading-5">
                      Sumá tu primera prenda para empezar a armar la colección.
                    </p>
                  )}
                  <div className="border-border mt-2 border-t px-5 py-3">
                    <Link
                      href="/admin/products"
                      className="flex min-h-10 items-center justify-between gap-3 text-sm font-medium hover:underline"
                    >
                      Gestionar productos <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </div>
                </>
              ) : (
                <p className="border-border text-muted-foreground border-t px-5 py-7 text-sm">
                  No se pudo cargar el catálogo. Volvé a intentarlo con Actualizar.
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {shortcuts.length > 0 && (
        <section aria-labelledby="quick-access-title" className="pt-1">
          <h2 id="quick-access-title" className="mb-4 text-sm font-medium">
            Seguí con tu día
          </h2>
          <div
            className={cn(
              "grid gap-3",
              shortcuts.length > 1 && "sm:grid-cols-2",
              shortcuts.length === 3 && "xl:grid-cols-3",
              shortcuts.length === 4 && "xl:grid-cols-4",
            )}
          >
            {shortcuts.map((shortcut) => (
              <Link
                key={shortcut.href}
                href={shortcut.href}
                className="group border-border focus-visible:ring-ring flex min-h-20 items-center justify-between gap-3 rounded-md border px-4 py-3 transition-colors outline-none hover:border-[#a8b1a3] hover:bg-white focus-visible:ring-2"
              >
                <span>
                  <span className="block text-sm font-medium">{shortcut.label}</span>
                  <span className="text-muted-foreground mt-1 block text-xs leading-5">
                    {shortcut.description}
                  </span>
                </span>
                <ArrowUpRight
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      {metrics.length === 0 && (
        <p className="border-border text-muted-foreground rounded-lg border bg-white p-5 text-sm leading-6">
          Tu cuenta ya puede acceder a la administración. Los módulos disponibles para tu rol
          aparecen en el menú.
        </p>
      )}
    </div>
  );
}

async function loadProductStats() {
  const products = await listProducts();
  const allVariantIds = products.flatMap((product) =>
    product.variants.map((variant) => variant.id),
  );
  const stockByVariantId = await getStockByVariantIds(allVariantIds);
  const stats = {
    total: products.length,
    published: 0,
    outOfStock: 0,
    ready: 0,
    incomplete: 0,
    blocked: 0,
  };

  for (const product of products) {
    const totalStock = product.variants.reduce(
      (sum, variant) => sum + (stockByVariantId.get(variant.id) ?? 0),
      0,
    );
    const { status } = computeProductListStatus(product, product.variants, totalStock);
    if (status === "PUBLISHED" || status === "OUT_OF_STOCK") stats.published++;
    if (status === "OUT_OF_STOCK") stats.outOfStock++;
    if (status === "READY_TO_PUBLISH") stats.ready++;
    if (status === "DRAFT_INCOMPLETE") stats.incomplete++;
    if (status === "BLOCKED") stats.blocked++;
  }

  return stats;
}
