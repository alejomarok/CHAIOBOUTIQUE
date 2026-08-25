import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { minorUnitsToDisplay } from "@/lib/money";
import { resolveDatePreset, type DateRangePreset } from "@/lib/store-timezone";
import { requirePermission } from "@/modules/auth";
import { getInvoicingStatusForSales } from "@/modules/fiscal-documents/fiscal-document";
import {
  INVOICE_MODE_LABELS_ES,
  SALE_INVOICING_STATUS_BADGE_VARIANT,
  SALE_INVOICING_STATUS_LABELS_ES,
} from "@/modules/fiscal-documents/labels";
import { PAYMENT_METHOD_LABELS_ES, PAYMENT_STATUS_BADGE_VARIANT, PAYMENT_STATUS_LABELS_ES } from "@/modules/sales/payment-labels";
import {
  deriveSaleOrigin,
  getSalesReportSummary,
  listSalesForReport,
  listSaleSellers,
  type SaleOrigin,
} from "@/modules/sales/report";
import { getStoreConfiguration } from "@/modules/store-settings/service";
import { listWarehouses } from "@/modules/warehouses/service";
import type { SaleStatus } from "@/generated/prisma/client";

import { ExportButtons } from "./export-buttons";
import { parsePageNumber, parseSalesConsultationFilters, type SalesConsultationSearchParams } from "./search-params";

export const metadata = { title: "Consultas de ventas" };

const PAGE_SIZE = 25;

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
const ORIGIN_LABELS_ES: Record<SaleOrigin, string> = { POS: "Venta en local", ONLINE: "Venta online" };

const DATE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "this_week", label: "Esta semana" },
  { key: "this_month", label: "Este mes" },
  { key: "last_month", label: "Mes anterior" },
];

function formatAmount(amount: bigint): string {
  return minorUnitsToDisplay(amount);
}

interface SalesConsultationPageProps {
  searchParams: Promise<SalesConsultationSearchParams>;
}

export default async function SalesConsultationPage({ searchParams }: SalesConsultationPageProps) {
  await requirePermission("sales.view");
  const params = await searchParams;
  const storeConfig = await getStoreConfiguration();
  const timezone = storeConfig.timezone;

  const filters = parseSalesConsultationFilters(params, timezone);
  const page = parsePageNumber(params.page);

  const [{ sales, total }, summary, warehouses, sellers] = await Promise.all([
    listSalesForReport({ ...filters, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    getSalesReportSummary(filters),
    listWarehouses(),
    listSaleSellers(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // One batched query for the whole page, never N+1 — see
  // getInvoicingStatusForSales's own comment.
  const invoicingStatusBySale = await getInvoicingStatusForSales(sales.map((sale) => sale.id));

  const now = new Date();
  const presetRanges = DATE_PRESETS.map((preset) => ({
    ...preset,
    range: resolveDatePreset(preset.key, now, timezone),
  }));

  const hasAnyFilter = Object.values(params).some((value) => value !== undefined && value !== "");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Consultas de ventas</h1>
          <p className="text-muted-foreground text-sm">
            Buscá, filtrá y resumí las operaciones comerciales históricas.
          </p>
        </div>
        <ExportButtons filters={params} />
      </div>

      <details className="border-border rounded-xl border" open>
        <summary className="cursor-pointer list-none p-4 font-medium select-none">
          <span className="inline-flex items-center gap-2">Filtros</span>
        </summary>
        <div className="flex flex-col gap-4 border-t p-4">
          <div className="flex flex-wrap gap-2">
            {presetRanges.map((preset) => (
              <Button key={preset.key} asChild size="sm" variant="outline">
                <Link
                  href={{
                    pathname: "/admin/sales/consultation",
                    query: { ...params, from: preset.range.fromDateString, to: preset.range.toDateString, page: undefined },
                  }}
                >
                  {preset.label}
                </Link>
              </Button>
            ))}
          </div>

          <form method="GET" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">Desde</Label>
              <Input id="from" name="from" type="date" defaultValue={params.from ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">Hasta</Label>
              <Input id="to" name="to" type="date" defaultValue={params.to ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Código de venta</Label>
              <Input id="code" name="code" defaultValue={params.code ?? ""} placeholder="VEN-00125" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer">Cliente (nombre o documento)</Label>
              <Input id="customer" name="customer" defaultValue={params.customer ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product">Producto o SKU</Label>
              <Input id="product" name="product" defaultValue={params.product ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status">Estado de la venta</Label>
              <select
                id="status"
                name="status"
                defaultValue={params.status ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="CONFIRMED">Confirmada</option>
                <option value="CANCELLED">Cancelada</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paymentStatus">Estado del pago</Label>
              <select
                id="paymentStatus"
                name="paymentStatus"
                defaultValue={params.paymentStatus ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="UNPAID">Sin pagar</option>
                <option value="PARTIALLY_PAID">Pago parcial</option>
                <option value="PAID">Pagada</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoicingStatus">Facturación</Label>
              <select
                id="invoicingStatus"
                name="invoicingStatus"
                defaultValue={params.invoicingStatus ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todas</option>
                <option value="NOT_INVOICED">Sin facturar</option>
                <option value="PENDING">Pendiente</option>
                <option value="INVOICED">Facturada</option>
                <option value="ERROR">Error</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoicingMode">Modalidad de facturación</Label>
              <select
                id="invoicingMode"
                name="invoicingMode"
                defaultValue={params.invoicingMode ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todas</option>
                {Object.entries(INVOICE_MODE_LABELS_ES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="origin">Origen</Label>
              <select
                id="origin"
                name="origin"
                defaultValue={params.origin ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="POS">Venta en local</option>
                <option value="ONLINE">Venta online</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paymentMethod">Medio de pago</Label>
              <select
                id="paymentMethod"
                name="paymentMethod"
                defaultValue={params.paymentMethod ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todos</option>
                {Object.entries(PAYMENT_METHOD_LABELS_ES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="warehouseId">Depósito</Label>
              <select
                id="warehouseId"
                name="warehouseId"
                defaultValue={params.warehouseId ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todos</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sellerId">Vendedor</Label>
              <select
                id="sellerId"
                name="sellerId"
                defaultValue={params.sellerId ?? ""}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">Todos</option>
                {sellers.map((seller) => (
                  <option key={seller.id} value={seller.id}>
                    {seller.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm">
                Buscar
              </Button>
              {hasAnyFilter && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/admin/sales/consultation">Limpiar filtros</Link>
                </Button>
              )}
            </div>
          </form>
        </div>
      </details>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Cantidad de ventas" value={String(summary.saleCount)} />
        <SummaryCard label="Total vendido" value={formatAmount(summary.totalSoldAmount)} />
        <SummaryCard label="Total cobrado" value={formatAmount(summary.totalCollectedAmount)} />
        <SummaryCard label="Saldo pendiente" value={formatAmount(summary.totalPendingAmount)} />
        <SummaryCard
          label="Ticket promedio"
          value={summary.averageTicketAmount !== null ? formatAmount(summary.averageTicketAmount) : "—"}
        />
      </div>

      {summary.cancelledCount > 0 && (
        <p className="text-muted-foreground text-sm">
          Ventas canceladas en este período: {summary.cancelledCount} ({formatAmount(summary.cancelledAmount)}) — no
          incluidas en el total vendido.
        </p>
      )}

      {sales.length === 0 ? (
        <div className="border-border rounded-xl border p-8 text-center">
          <p className="text-muted-foreground text-sm">No encontramos ventas para los filtros seleccionados.</p>
          {hasAnyFilter && (
            <Button asChild className="mt-4" variant="outline">
              <Link href="/admin/sales/consultation">Limpiar filtros</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop/tablet: table. */}
          <div className="border-border hidden overflow-x-auto rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venta</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead>Facturación</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => {
                  const invoicingStatus = invoicingStatusBySale.get(sale.id) ?? "NOT_INVOICED";
                  const origin = deriveSaleOrigin(sale);
                  return (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono text-xs">{sale.code}</TableCell>
                      <TableCell>{new Date(sale.saleDate).toLocaleString("es-AR")}</TableCell>
                      <TableCell>{sale.customerNameSnapshot}</TableCell>
                      <TableCell>{ORIGIN_LABELS_ES[origin]}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE_VARIANT[sale.status]}>{STATUS_LABELS_ES[sale.status]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[sale.paymentStatus]}>
                          {PAYMENT_STATUS_LABELS_ES[sale.paymentStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={SALE_INVOICING_STATUS_BADGE_VARIANT[invoicingStatus]}>
                          {SALE_INVOICING_STATUS_LABELS_ES[invoicingStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatAmount(sale.totalAmount)}</TableCell>
                      <TableCell>{sale.createdBy.name}</TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/sales/${sale.id}`}>Ver detalle</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards — never a giant horizontally-scrolling table. */}
          <div className="flex flex-col gap-3 md:hidden">
            {sales.map((sale) => {
              const invoicingStatus = invoicingStatusBySale.get(sale.id) ?? "NOT_INVOICED";
              const origin = deriveSaleOrigin(sale);
              return (
                <Link
                  key={sale.id}
                  href={`/admin/sales/${sale.id}`}
                  className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">{sale.code}</span>
                    <span className="font-semibold">{formatAmount(sale.totalAmount)}</span>
                  </div>
                  <p className="font-medium">{sale.customerNameSnapshot}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(sale.saleDate).toLocaleString("es-AR")} · {ORIGIN_LABELS_ES[origin]}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={STATUS_BADGE_VARIANT[sale.status]}>{STATUS_LABELS_ES[sale.status]}</Badge>
                    <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[sale.paymentStatus]}>
                      {PAYMENT_STATUS_LABELS_ES[sale.paymentStatus]}
                    </Badge>
                    <Badge variant={SALE_INVOICING_STATUS_BADGE_VARIANT[invoicingStatus]}>
                      {SALE_INVOICING_STATUS_LABELS_ES[invoicingStatus]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">Vendedor: {sale.createdBy.name}</p>
                </Link>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-sm">
                Página {page} de {totalPages} ({total} ventas)
              </p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={{ pathname: "/admin/sales/consultation", query: { ...params, page: page - 1 } }}>
                      Anterior
                    </Link>
                  </Button>
                )}
                {page < totalPages && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={{ pathname: "/admin/sales/consultation", query: { ...params, page: page + 1 } }}>
                      Siguiente
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
