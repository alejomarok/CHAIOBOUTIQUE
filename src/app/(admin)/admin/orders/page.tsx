import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { minorUnitsToDisplay } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import {
  DELIVERY_METHOD_LABELS_ES,
  ORDER_PAYMENT_STATUS_BADGE_VARIANT,
  ORDER_PAYMENT_STATUS_LABELS_ES,
  ORDER_STATUS_BADGE_VARIANT,
  ORDER_STATUS_LABELS_ES,
} from "@/modules/orders/order-labels";
import { expireStaleOrdersAndReservations, listOrders } from "@/modules/orders/order";
import type { DeliveryMethod, OrderPaymentStatus, OrderStatus } from "@/generated/prisma/client";

export const metadata = { title: "Pedidos" };

const PAGE_SIZE = 25;

interface OrdersPageProps {
  searchParams: Promise<{
    q?: string;
    status?: string;
    paymentStatus?: string;
    deliveryMethod?: string;
    page?: string;
  }>;
}

function isValidStatus(value: string | undefined): value is OrderStatus {
  return (
    value === "PENDING_PAYMENT" ||
    value === "PAID" ||
    value === "PROCESSING" ||
    value === "READY_FOR_PICKUP" ||
    value === "SHIPPED" ||
    value === "DELIVERED" ||
    value === "CANCELLED" ||
    value === "EXPIRED"
  );
}

function isValidPaymentStatus(value: string | undefined): value is OrderPaymentStatus {
  return value === "UNPAID" || value === "PARTIALLY_PAID" || value === "PAID";
}

function isValidDeliveryMethod(value: string | undefined): value is DeliveryMethod {
  return value === "PICKUP" || value === "HOME_DELIVERY";
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  await requirePermission("orders.view");

  // Opportunistic sweep — see modules/orders/order-core.ts's
  // expireStaleOrdersAndReservations own doc comment: no scheduler exists
  // yet, so a safe, cheap point like "an admin is looking at the Orders
  // list" keeps stale PENDING_PAYMENT Orders from lingering indefinitely
  // instead of showing their real EXPIRED state.
  await expireStaleOrdersAndReservations();

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = isValidStatus(params.status) ? params.status : undefined;
  const paymentStatus = isValidPaymentStatus(params.paymentStatus) ? params.paymentStatus : undefined;
  const deliveryMethod = isValidDeliveryMethod(params.deliveryMethod) ? params.deliveryMethod : undefined;

  const { orders, total } = await listOrders({
    search: params.q || undefined,
    status,
    paymentStatus,
    deliveryMethod,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Pedidos</h1>
        <p className="text-muted-foreground text-sm">Pedidos generados desde la tienda online.</p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q">Buscar</Label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="Código, nombre o email" className="w-64" />
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
            {Object.entries(ORDER_STATUS_LABELS_ES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
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
            {Object.entries(ORDER_PAYMENT_STATUS_LABELS_ES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deliveryMethod">Entrega</Label>
          <select
            id="deliveryMethod"
            name="deliveryMethod"
            defaultValue={params.deliveryMethod ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Todas</option>
            {Object.entries(DELIVERY_METHOD_LABELS_ES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          Buscar
        </Button>
      </form>

      {orders.length === 0 ? (
        <div className="border-border rounded-xl border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            {params.q || status || paymentStatus || deliveryMethod
              ? "No encontramos pedidos con esos filtros."
              : "Todavía no hay pedidos."}
          </p>
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado del pago</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/admin/orders/${order.id}`} className="hover:underline">
                      {order.code}
                    </Link>
                  </TableCell>
                  <TableCell>{order.createdAt.toLocaleDateString("es-AR")}</TableCell>
                  <TableCell>{order.contactNameSnapshot}</TableCell>
                  <TableCell>{DELIVERY_METHOD_LABELS_ES[order.deliveryMethod]}</TableCell>
                  <TableCell>{minorUnitsToDisplay(order.totalAmount, { currency: order.currency })}</TableCell>
                  <TableCell>
                    <Badge variant={ORDER_PAYMENT_STATUS_BADGE_VARIANT[order.paymentStatus]}>
                      {ORDER_PAYMENT_STATUS_LABELS_ES[order.paymentStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={ORDER_STATUS_BADGE_VARIANT[order.status]}>
                      {ORDER_STATUS_LABELS_ES[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/orders/${order.id}`}>Ver</Link>
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
            Página {page} de {totalPages} ({total} pedidos)
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link href={{ pathname: "/admin/orders", query: { ...params, page: page - 1 } }}>
                  Anterior
                </Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild size="sm" variant="outline">
                <Link href={{ pathname: "/admin/orders", query: { ...params, page: page + 1 } }}>
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
