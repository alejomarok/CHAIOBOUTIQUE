import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getReservationSchedulerReadiness } from "@/modules/orders/order";

// Phase — Mercado Pago Real Sandbox Validation + Reservation Scheduler.
// "Tarea automática" reflects only whether POST /api/internal/
// expire-stale-orders is securely invocable (INTERNAL_TASK_SECRET
// configured) — this app has no way to confirm an external scheduler is
// actually calling it on an interval, so the copy is deliberately phrased
// as endpoint readiness, never a claim that a cron is running. See
// DATABASE.md-equivalent guidance in INTEGRATIONS.md for how to actually
// wire a scheduler up.
export function ReservationSchedulerCard() {
  const readiness = getReservationSchedulerReadiness();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reservas</CardTitle>
        <CardDescription>
          Reserva de stock durante el checkout online y su liberación automática.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm">
          <li className="text-muted-foreground">Duración: {readiness.reservationWindowMinutes} minutos</li>
          <li className="text-muted-foreground">
            {readiness.internalEndpointConfigured ? "✓" : "✕"} Tarea automática:{" "}
            {readiness.internalEndpointConfigured ? "Configurada" : "Pendiente"}
          </li>
        </ul>
        {!readiness.internalEndpointConfigured && (
          <p className="text-muted-foreground mt-2 text-xs">
            Falta configurar INTERNAL_TASK_SECRET y un job programado que llame a
            /api/internal/expire-stale-orders en un intervalo menor a la duración de la reserva.
          </p>
        )}
        {readiness.internalEndpointConfigured && (
          <p className="text-muted-foreground mt-2 text-xs">
            El endpoint está protegido y listo para invocarse — esto no confirma que un job externo
            lo esté llamando efectivamente; verificalo en la configuración del scheduler.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
