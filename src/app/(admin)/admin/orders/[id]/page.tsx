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
import { getSaleInvoicingSummary } from "@/modules/fiscal-documents/fiscal-document";
import {
  SALE_INVOICING_STATUS_BADGE_VARIANT,
  SALE_INVOICING_STATUS_LABELS_ES,
} from "@/modules/fiscal-documents/labels";
import { getOrderById } from "@/modules/orders/order";
import {
  DELIVERY_METHOD_LABELS_ES,
  ORDER_PAYMENT_STATUS_BADGE_VARIANT,
  ORDER_PAYMENT_STATUS_LABELS_ES,
  ORDER_STATUS_BADGE_VARIANT,
  ORDER_STATUS_LABELS_ES,
  PAYMENT_ATTEMPT_STATUS_BADGE_VARIANT,
  PAYMENT_ATTEMPT_STATUS_LABELS_ES,
} from "@/modules/orders/order-labels";

import { CancelOrderButton } from "./cancel-order-button";
import { VerifyPaymentButton } from "./verify-payment-button";
import { FulfillmentForm } from "@/components/orders/fulfillment-form";
import { FULFILLMENT_TRANSITIONS } from "@/modules/orders/fulfillment-core";
import { resolveAdjustmentAction } from "../actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Detalle de pedido" };

const RESERVATION_STATUS_LABELS_ES: Record<string, string> = {
  ACTIVE: "Activa",
  CONSUMED: "Consumida",
  RELEASED: "Liberada",
  EXPIRED: "Vencida",
};

function formatAddress(order: {
  shippingStreet: string | null;
  shippingNumber: string | null;
  shippingFloor: string | null;
  shippingApartment: string | null;
  shippingCity: string | null;
  shippingProvince: string | null;
  shippingPostalCode: string | null;
  shippingNotes: string | null;
}): string {
  return [
    [order.shippingStreet, order.shippingNumber].filter(Boolean).join(" "),
    [order.shippingFloor, order.shippingApartment].filter(Boolean).join(" "),
    order.shippingCity,
    order.shippingProvince,
    order.shippingPostalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("orders.view");
  const canCancel = user.permissions.has("orders.cancel");
  const canManagePayments = user.permissions.has("orders.manage");
  const canViewInvoicing = user.permissions.has("invoices.view");
  const { id } = await params;

  const order = await getOrderById(id);
  if (!order) notFound();

  // Most recent attempt first (paymentAttempts is already ordered
  // createdAt desc — see orderDetailInclude in modules/orders/order-core.ts).
  const latestPaymentAttempt = order.paymentAttempts[0] ?? null;

  // Fiscal documents belong to the commercial Sale, never the Order — see
  // this phase's explicit "Order -> Sale -> FiscalDocument" boundary.
  // Fetched here (composed by the page, not by order-core.ts itself) so
  // neither module depends on the other.
  const saleInvoicingSummary =
    canViewInvoicing && order.sale ? await getSaleInvoicingSummary(order.sale.id) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{order.code}</h1>
            <Badge variant={ORDER_STATUS_BADGE_VARIANT[order.status]}>
              {ORDER_STATUS_LABELS_ES[order.status]}
            </Badge>
            <Badge variant={ORDER_PAYMENT_STATUS_BADGE_VARIANT[order.paymentStatus]}>
              {ORDER_PAYMENT_STATUS_LABELS_ES[order.paymentStatus]}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {order.createdAt.toLocaleString("es-AR")}
          </p>
          <p className="mt-1 text-sm font-medium">Depósito: {order.warehouse.name}</p>
          {order.status === "PENDING_PAYMENT" && order.reservationExpiresAt && (
            <p className="text-sm">
              Reserva activa hasta: {order.reservationExpiresAt.toLocaleString("es-AR")}
            </p>
          )}
        </div>
        {canCancel && order.status === "PENDING_PAYMENT" && (
          <CancelOrderButton orderId={order.id} />
        )}
      </div>

      {order.requiresPaymentReview && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="text-destructive pt-6 text-sm font-medium">
            El pago de este pedido requiere revisión.
            {order.paymentReviewReason && (
              <p className="text-destructive/90 mt-1 font-normal">{order.paymentReviewReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {canManagePayments && (
        <Card>
          <CardHeader>
            <CardTitle>Preparación y entrega</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm">
              Los cambios de entrega quedan registrados y generan una notificación al cliente.
            </p>
            {!order.requiresPaymentReview &&
              ["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus) && (
                <FulfillmentForm
                  key={order.status}
                  orderId={order.id}
                  options={(FULFILLMENT_TRANSITIONS[order.status] ?? [])
                    .filter(
                      (status) =>
                        status !==
                        (order.deliveryMethod === "PICKUP" ? "SHIPPED" : "READY_FOR_PICKUP"),
                    )
                    .map((value) => ({ value, label: ORDER_STATUS_LABELS_ES[value] }))}
                />
              )}
            {order.trackingNumber && (
              <p>
                Seguimiento: {order.trackingCarrier} {order.trackingNumber}
              </p>
            )}
            {order.requiresPaymentReview &&
              ["REFUNDED", "PARTIALLY_REFUNDED", "CHARGED_BACK"].includes(order.paymentStatus) && (
                <form action={resolveAdjustmentAction} className="grid gap-4">
                  <input type="hidden" name="orderId" value={order.id} />
                  <label className="grid gap-2">
                    Resolución
                    <select
                      name="decision"
                      className="bg-background min-h-11 rounded-md border px-3"
                    >
                      <option value="CANCEL">Cerrar la entrega por el ajuste</option>
                      {order.paymentStatus === "PARTIALLY_REFUNDED" && (
                        <option value="CONTINUE">Continuar la entrega acordada</option>
                      )}
                    </select>
                  </label>
                  <label className="flex items-start gap-3 text-sm leading-6">
                    <input type="checkbox" name="confirmed" required className="mt-1 size-5" />
                    Revisé el reembolso o contracargo. La devolución física y el stock se controlan
                    por separado.
                  </label>
                  <Button className="min-h-11 justify-self-start" type="submit">
                    Registrar resolución
                  </Button>
                </form>
              )}
          </CardContent>
        </Card>
      )}

      {order.paymentAdjustments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ajustes informados por Mercado Pago</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {order.paymentAdjustments.map((adjustment) => (
              <p key={adjustment.id}>
                {adjustment.kind === "REFUND" ? "Reembolso" : "Contracargo"}:{" "}
                {minorUnitsToDisplay(adjustment.amount, { currency: adjustment.currency })} ·{" "}
                {adjustment.createdAt.toLocaleString("es-AR")}
              </p>
            ))}
            <p>
              El ajuste financiero no repone stock. Registrá un ajuste de inventario solo después de
              recibir y revisar las prendas.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contacto</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">Nombre</p>
            <p>{order.contactNameSnapshot}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Email</p>
            <p>{order.contactEmailSnapshot}</p>
          </div>
          {order.contactPhoneSnapshot && (
            <div>
              <p className="text-muted-foreground text-xs">Teléfono</p>
              <p>{order.contactPhoneSnapshot}</p>
            </div>
          )}
          {order.customer ? (
            <div>
              <p className="text-muted-foreground text-xs">Cliente vinculado</p>
              <Link href={`/admin/customers/${order.customer.id}`} className="underline">
                {order.customer.code}
              </Link>
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground text-xs">Cliente</p>
              <p>Invitado (sin cuenta)</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entrega</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="font-medium">{DELIVERY_METHOD_LABELS_ES[order.deliveryMethod]}</p>
          {order.deliveryMethod === "HOME_DELIVERY" && (
            <p className="text-muted-foreground mt-1">{formatAddress(order)}</p>
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
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p>{item.productNameSnapshot}</p>
                      {(item.sizeNameSnapshot || item.colorNameSnapshot) && (
                        <p className="text-muted-foreground text-xs">
                          {[item.sizeNameSnapshot, item.colorNameSnapshot]
                            .filter(Boolean)
                            .join(" / ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.skuSnapshot}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>
                      {minorUnitsToDisplay(item.unitPriceAmount, { currency: order.currency })}
                    </TableCell>
                    <TableCell>
                      {minorUnitsToDisplay(item.totalAmount, { currency: order.currency })}
                    </TableCell>
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
            <span>{minorUnitsToDisplay(order.subtotalAmount, { currency: order.currency })}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Envío</span>
            <span>{minorUnitsToDisplay(order.shippingAmount, { currency: order.currency })}</span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{minorUnitsToDisplay(order.totalAmount, { currency: order.currency })}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pago</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {latestPaymentAttempt ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-xs">Estado</p>
                  <Badge
                    variant={PAYMENT_ATTEMPT_STATUS_BADGE_VARIANT[latestPaymentAttempt.status]}
                  >
                    {PAYMENT_ATTEMPT_STATUS_LABELS_ES[latestPaymentAttempt.status]}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Medio</p>
                  <p>Mercado Pago</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Importe</p>
                  <p>
                    {minorUnitsToDisplay(latestPaymentAttempt.amount, {
                      currency: latestPaymentAttempt.currency,
                    })}
                  </p>
                </div>
                {latestPaymentAttempt.approvedAt && (
                  <div>
                    <p className="text-muted-foreground text-xs">Fecha</p>
                    <p>{latestPaymentAttempt.approvedAt.toLocaleString("es-AR")}</p>
                  </div>
                )}
                {latestPaymentAttempt.providerPaymentId && (
                  <div>
                    <p className="text-muted-foreground text-xs">ID Mercado Pago</p>
                    <p className="font-mono text-xs">{latestPaymentAttempt.providerPaymentId}</p>
                  </div>
                )}
                {order.sale && (
                  <div>
                    <p className="text-muted-foreground text-xs">Venta generada</p>
                    <Link href={`/admin/sales/${order.sale.id}`} className="underline">
                      {order.sale.code}
                    </Link>
                    {saleInvoicingSummary && (
                      <Badge
                        variant={SALE_INVOICING_STATUS_BADGE_VARIANT[saleInvoicingSummary.status]}
                        className="ml-2"
                      >
                        {SALE_INVOICING_STATUS_LABELS_ES[saleInvoicingSummary.status]}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              {latestPaymentAttempt.failureDetail && (
                <p className="text-muted-foreground text-xs">
                  {latestPaymentAttempt.failureDetail}
                </p>
              )}
              {canManagePayments && latestPaymentAttempt.providerPaymentId && (
                <div>
                  <VerifyPaymentButton orderId={order.id} />
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Todavía no se inició un pago con Mercado Pago.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reserva de stock</CardTitle>
        </CardHeader>
        <CardContent>
          {order.reservations.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin reservas.</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              {order.reservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="border-border flex items-center justify-between rounded-lg border p-2"
                >
                  <span>Cantidad: {reservation.quantity}</span>
                  <Badge variant="outline">
                    {RESERVATION_STATUS_LABELS_ES[reservation.status] ?? reservation.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {order.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
          </CardContent>
        </Card>
      )}

      {order.status === "CANCELLED" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle>Cancelación</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Cancelado {order.cancelledAt && order.cancelledAt.toLocaleString("es-AR")}</p>
            {order.cancelledBy && <p>Por {order.cancelledBy.name}</p>}
            {order.cancellationReason && <p>Motivo: {order.cancellationReason}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
