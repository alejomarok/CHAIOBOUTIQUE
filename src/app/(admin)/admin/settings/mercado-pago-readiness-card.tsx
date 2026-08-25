import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMercadoPagoReadiness } from "@/modules/payments/mercado-pago";

// Admin-facing configuration checklist for the Mercado Pago Checkout Pro
// integration — env-var driven (see src/lib/env-core.ts and modules/
// payments/mercado-pago/config-core.ts's getMercadoPagoReadiness), never
// editable from this UI (these are server secrets, set in .env / the
// hosting provider's environment config, never through an admin form).
// Only booleans and labels ever reach this component — never a token/
// secret value, matching getMercadoPagoReadiness's own documented
// contract.
export function MercadoPagoReadinessCard() {
  const readiness = getMercadoPagoReadiness();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mercado Pago — {readiness.environmentLabel}</CardTitle>
        <CardDescription>
          Se configura con variables de entorno (.env), nunca desde esta pantalla. Estado actual:{" "}
          <span className="text-foreground font-medium">
            {readiness.configured ? "Configurado" : "No configurado"}
          </span>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm">
          {readiness.checks.map((check) => (
            <li key={check.key} className="text-muted-foreground">
              {check.ok ? "✓" : "✕"} {check.label}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
