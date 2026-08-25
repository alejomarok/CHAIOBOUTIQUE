import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getArcaConnectionReadiness, getArcaDataReadiness } from "@/modules/fiscal-documents/arca";

import { TestArcaConnectionButton } from "./test-arca-connection-button";

// Section 15: shows real readiness, never a fake "working" state. Four
// possible headline states — "No configurada" (nothing at all set yet),
// "Configuración incompleta" (some but not all data blockers resolved),
// "Datos completos, conexión pendiente" (data ready but the certificate/
// environment connection check still has blockers — see readiness-core.ts's
// own header comment for the DATA vs. CONNECTION distinction, now both
// real checks as of the ARCA Homologation phase), "Lista para homologación"
// (both ready). Never says "lista para producción" — this codebase never
// implements the production posture.
const TOTAL_DATA_CHECKS = 5;

export async function ArcaReadinessCard() {
  const [dataReadiness, connectionReadiness] = await Promise.all([
    getArcaDataReadiness(),
    getArcaConnectionReadiness(),
  ]);

  const headline =
    dataReadiness.ready && connectionReadiness.ready
      ? "Lista para homologación"
      : dataReadiness.ready
        ? "Datos completos, conexión pendiente"
        : dataReadiness.blockers.length >= TOTAL_DATA_CHECKS
          ? "No configurada"
          : "Configuración incompleta";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Facturación electrónica — ARCA</CardTitle>
        <CardDescription>
          Estado: <span className="text-foreground font-medium">{headline}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div>
          <p className="mb-2 font-medium">Datos fiscales del emisor</p>
          {dataReadiness.ready ? (
            <p className="text-muted-foreground">✓ Todos los datos fiscales necesarios están completos.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {dataReadiness.blockers.map((blocker) => (
                <li key={blocker.code} className="text-muted-foreground">
                  ✕ {blocker.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 font-medium">Conexión con ARCA (Homologación)</p>
          {connectionReadiness.ready ? (
            <p className="text-muted-foreground">✓ Certificado y entorno de Homologación configurados.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {connectionReadiness.blockers.map((blocker) => (
                <li key={blocker.code} className="text-muted-foreground">
                  ✕ {blocker.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        {connectionReadiness.ready && (
          <div>
            <TestArcaConnectionButton />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
