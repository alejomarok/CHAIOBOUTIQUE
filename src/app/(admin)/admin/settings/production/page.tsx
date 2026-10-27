import Link from "next/link";
import { requirePermission } from "@/modules/auth";
import { getProductionReadiness } from "@/modules/production/readiness-core";
import { Button } from "@/components/ui/button";
import { retryNotificationsAction } from "./actions";

export const metadata = { title: "Preparación para publicar" };
export default async function ProductionPage() {
  const actor = await requirePermission("settings.view");
  const report = await getProductionReadiness();
  return (
    <div className="grid max-w-3xl gap-6">
      <Link href="/admin/settings" className="underline">
        Volver a configuración
      </Link>
      <h1 className="font-heading text-3xl">Preparación para publicar</h1>
      <p className="text-muted-foreground leading-7">
        Estos controles verifican la configuración guardada. Antes de abrir la tienda, comprobá una
        compra real, la llegada de los correos, el funcionamiento de las tareas programadas y la
        recuperación de una copia de seguridad.
      </p>
      <ul className="divide-y rounded-xl border px-5">
        {report.checks.map((check) => (
          <li key={check.label} className="flex items-center justify-between gap-4 py-4">
            <span>{check.label}</span>
            <span className={check.ready ? "text-emerald-700" : "font-semibold text-amber-800"}>
              {check.ready ? "Listo" : "Pendiente"}
            </span>
          </li>
        ))}
      </ul>
      <p>
        Correos pendientes: {report.pendingEmails}. Correos que necesitan atención:{" "}
        {report.failedEmails}.
      </p>
      {actor.permissions.has("settings.manage") && report.failedEmails > 0 && (
        <form action={retryNotificationsAction}>
          <Button type="submit">Reintentar correos fallidos</Button>
        </form>
      )}
      <div className="rounded-xl border p-5 leading-7">
        <h2 className="font-heading text-xl">Facturación y operación</h2>
        <p>
          Para el lanzamiento, emití los comprobantes en tu sistema fiscal habilitado y registralos
          en cada venta como comprobante manual o de sistema externo. La conexión ARCA incorporada
          es de homologación y no emite comprobantes fiscales de producción.
        </p>
        <p className="mt-3">
          Vercel debe ejecutar el mantenimiento cada cinco minutos. El cron incluido requiere un
          plan con esa frecuencia, o un programador externo que llame al mismo endpoint protegido.
          Verificá sus ejecuciones y alertas en el alojamiento.
        </p>
      </div>
    </div>
  );
}
