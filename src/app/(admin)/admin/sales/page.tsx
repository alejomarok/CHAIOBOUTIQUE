import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { requirePermission } from "@/modules/auth";
import { listSales } from "@/modules/sales/sale";
import type { SaleStatus } from "@/generated/prisma/client";

export const metadata = { title: "Ventas" };

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

interface SalesPageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

function isValidStatus(value: string | undefined): value is SaleStatus {
  return value === "DRAFT" || value === "CONFIRMED" || value === "CANCELLED";
}

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const user = await requirePermission("sales.view");
  const canCreate = user.permissions.has("sales.create");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = isValidStatus(params.status) ? params.status : undefined;

  const { sales, total } = await listSales({
    search: params.q || undefined,
    status,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Ventas</h1>
          <p className="text-muted-foreground text-sm">
            Ventas manuales/mostrador registradas desde el panel.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/admin/sales/new">Nueva venta</Link>
          </Button>
        )}
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q">Buscar</Label>
          <Input
            id="q"
            name="q"
            defaultValue={params.q}
            placeholder="Código o cliente"
            className="w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Estado</Label>
          <select
            id="status"
            name="status"
            defaultValue={params.status ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Todos</option>
            <option value="DRAFT">Borrador</option>
            <option value="CONFIRMED">Confirmada</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          Buscar
        </Button>
      </form>

      {sales.length === 0 ? (
        <div className="border-border rounded-xl border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            {params.q || status ? "No encontramos ventas con esos filtros." : "Todavía no hay ventas registradas."}
          </p>
          {canCreate && !params.q && !status && (
            <Button asChild className="mt-4">
              <Link href="/admin/sales/new">Registrar la primera venta</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/admin/sales/${sale.id}`} className="hover:underline">
                      {sale.code}
                    </Link>
                  </TableCell>
                  <TableCell>{sale.customerNameSnapshot}</TableCell>
                  <TableCell>{new Date(sale.saleDate).toLocaleDateString("es-AR")}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[sale.status]}>
                      {STATUS_LABELS_ES[sale.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{minorUnitsToDisplay(sale.totalAmount)}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/sales/${sale.id}`}>Ver</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Página {page} de {totalPages} ({total} ventas)
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link href={{ pathname: "/admin/sales", query: { ...params, page: page - 1 } }}>
                  Anterior
                </Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild size="sm" variant="outline">
                <Link href={{ pathname: "/admin/sales", query: { ...params, page: page + 1 } }}>
                  Siguiente
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
