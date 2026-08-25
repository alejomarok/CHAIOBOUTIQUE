import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getOrderByAccessToken } from "@/modules/orders/order";

import { AutoRefreshWhileProcessing } from "./auto-refresh-while-processing";

export const metadata = { title: "Confirmando tu pago" };

// The controlled Checkout Pro return route — all three of a preference's
// back_urls (success/pending/failure) point here with a different `hint`
// query param (see modules/payments/mercado-pago/preference-core.ts). This
// page's ONLY job is UX: `hint` is NEVER trusted as proof of payment — see
// this integration's explicit "must NOT trust query-string status as proof
// of payment" requirement. Every render re-reads the real, current Order
// state from the database; the actual payment verification already
// happened (or is still happening) server-to-server, independently, via
// the Mercado Pago webhook — this page never finalizes anything itself.
export default async function OrderPaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ hint?: string }>;
}) {
  const { token } = await params;
  const { hint } = await searchParams;

  const order = await getOrderByAccessToken(token);
  if (!order) notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6">
      {order.requiresPaymentReview ? (
        <div className="bg-destructive/10 text-destructive w-full rounded-xl p-6 text-sm font-medium">
          Tu pedido necesita revisión. No vuelvas a pagar — nos vamos a contactar para resolverlo.
        </div>
      ) : order.status === "PAID" ? (
        <div className="w-full rounded-xl bg-emerald-50 p-6 text-emerald-900">
          <p className="text-lg font-semibold">¡Pago confirmado!</p>
          <p className="mt-2 text-sm">Pedido {order.code}</p>
          <p className="mt-1 text-sm">Pago: Mercado Pago — Estado: Pagado</p>
          <p className="mt-1 text-sm">Estamos preparando tu pedido.</p>
        </div>
      ) : order.status === "CANCELLED" ? (
        <div className="bg-muted w-full rounded-xl p-6 text-sm">Este pedido fue cancelado.</div>
      ) : order.status === "EXPIRED" ? (
        <div className="bg-muted w-full rounded-xl p-6 text-sm">
          El tiempo de reserva de este pedido venció y el stock fue liberado.
        </div>
      ) : hint === "failure" ? (
        <div className="w-full rounded-xl bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-medium">El pago no pudo completarse.</p>
          {order.reservationExpiresAt && order.reservationExpiresAt > new Date() && (
            <Link href={`/order/${token}`} className="mt-3 inline-block">
              <Button type="button">Intentar nuevamente</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="w-full rounded-xl bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-medium">Estamos confirmando tu pago...</p>
          <p className="mt-2">Estamos procesando tu pago. Esto puede demorar unos segundos.</p>
          <AutoRefreshWhileProcessing />
        </div>
      )}

      <Link href={`/order/${token}`} className="text-muted-foreground text-sm underline">
        Ver detalle del pedido
      </Link>
    </div>
  );
}
