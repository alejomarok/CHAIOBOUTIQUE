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
import { getOrderByAccessToken } from "@/modules/orders/order";
import {
  DELIVERY_METHOD_LABELS_ES,
  ORDER_STATUS_BADGE_VARIANT,
  ORDER_STATUS_LABELS_ES,
  ORDER_PAYMENT_STATUS_LABELS_ES,
} from "@/modules/orders/order-labels";
import { isMercadoPagoConfigured } from "@/modules/payments/mercado-pago";

import { PayWithMercadoPagoButton } from "./pay-with-mercado-pago-button";

export const metadata = { title: "Tu pedido" };

function formatAddress(
  order: NonNullable<Awaited<ReturnType<typeof getOrderByAccessToken>>>,
): string {
  return [
    [order.shippingStreet, order.shippingNumber].filter(Boolean).join(" "),
    [order.shippingFloor, order.shippingApartment].filter(Boolean).join(" "),
    order.shippingCity,
    order.shippingProvince,
  ]
    .filter(Boolean)
    .join(", ");
}

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Token possession IS the authorization here — see Order.accessTokenHash's
  // own schema comment. No public lookup by predictable sequential id
  // exists anywhere in this codebase.
  const order = await getOrderByAccessToken(token);
  if (!order) notFound();

  const now = new Date();
  const reservationActive =
    order.status === "PENDING_PAYMENT" &&
    order.reservationExpiresAt &&
    order.reservationExpiresAt > now;
  const minutesLeft = reservationActive
    ? Math.max(1, Math.ceil((order.reservationExpiresAt!.getTime() - now.getTime()) / 60_000))
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold sm:text-3xl">Pedido {order.code}</h1>
          <Badge variant={ORDER_STATUS_BADGE_VARIANT[order.status]}>
            {ORDER_STATUS_LABELS_ES[order.status]}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {order.createdAt.toLocaleString("es-AR")}
        </p>
      </div>

      {order.requiresPaymentReview && (
        <div className="bg-destructive/10 text-destructive rounded-xl p-4 text-sm font-medium">
          Tu pedido necesita revisión. No vuelvas a pagar — nos vamos a contactar para resolverlo.
        </div>
      )}
      {order.paymentStatus === "PAID" && (
        <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">¡Pago confirmado!</p>
          <p className="mt-1">Pago: Mercado Pago — Estado: Pagado</p>
          <p className="mt-1">{ORDER_STATUS_LABELS_ES[order.status]}</p>
        </div>
      )}
      {reservationActive && !order.requiresPaymentReview && (
        <div className="bg-blush/60 rounded-xl p-4 text-sm">
          Tu pedido está reservado durante {minutesLeft} {minutesLeft === 1 ? "minuto" : "minutos"}{" "}
          mientras completás el pago.
        </div>
      )}
      {order.status === "EXPIRED" && !order.requiresPaymentReview && (
        <div className="bg-muted rounded-xl p-4 text-sm">
          El tiempo de reserva de este pedido venció y el stock fue liberado. Si querés, volvé a
          armar tu carrito para intentar de nuevo.
        </div>
      )}
      {order.status === "CANCELLED" && (
        <div className="bg-muted rounded-xl p-4 text-sm">
          Este pedido fue cancelado
          {order.cancellationReason ? `: ${order.cancellationReason}` : "."}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contacto</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>{order.contactNameSnapshot}</p>
          <p className="text-muted-foreground">{order.contactEmailSnapshot}</p>
          {order.contactPhoneSnapshot && (
            <p className="text-muted-foreground">{order.contactPhoneSnapshot}</p>
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
            <p className="text-muted-foreground">{formatAddress(order)}</p>
          )}
          {order.trackingCarrier && <p>Transportista: {order.trackingCarrier}</p>}
          {order.trackingNumber && <p>Código de seguimiento: {order.trackingNumber}</p>}
          {order.trackingUrl && (
            <a
              href={order.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center underline"
            >
              Seguir el envío
            </a>
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
            <span>
              {order.shippingAmount > 0n
                ? minorUnitsToDisplay(order.shippingAmount, { currency: order.currency })
                : "Sin costo"}
            </span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{minorUnitsToDisplay(order.totalAmount, { currency: order.currency })}</span>
          </div>
        </CardContent>
      </Card>

      {order.paymentAdjustments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{ORDER_PAYMENT_STATUS_LABELS_ES[order.paymentStatus]}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              El proveedor informó estos ajustes del pago. Si tenés dudas sobre la entrega o la
              devolución de prendas, contactanos.
            </p>
            {order.paymentAdjustments.map((adjustment) => (
              <p key={adjustment.id}>
                {adjustment.kind === "REFUND" ? "Reembolso" : "Contracargo"}:{" "}
                {minorUnitsToDisplay(adjustment.amount, { currency: adjustment.currency })} ·{" "}
                {adjustment.createdAt.toLocaleDateString("es-AR")}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {order.status === "PENDING_PAYMENT" &&
        !order.requiresPaymentReview &&
        reservationActive &&
        isMercadoPagoConfigured() && (
          <div className="flex flex-col items-start gap-2">
            <PayWithMercadoPagoButton token={token} />
          </div>
        )}
    </div>
  );
}
