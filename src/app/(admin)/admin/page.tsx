import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/modules/auth";

export const metadata = { title: "Panel" };

// Placeholder metrics only — the sales/orders/inventory/reporting modules
// have not been built yet (they're out of scope for this foundation phase).
// Every card is explicitly labeled "Próximamente" rather than showing fake
// numbers. The layout and permission gating (e.g. profit hidden without
// reports.view_profit) are real and meant to be reused once real data
// exists.
const BASE_METRICS = [
  { label: "Ventas de hoy", description: "Se calculará una vez implementado el módulo de ventas." },
  {
    label: "Pedidos pendientes",
    description: "Se calculará una vez implementado el módulo de pedidos.",
  },
  {
    label: "Stock bajo",
    description: "Se calculará una vez implementado el módulo de inventario.",
  },
];

const PROFIT_METRIC = {
  label: "Rentabilidad estimada",
  description: "Visible solo para roles con permiso reports.view_profit.",
};

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  const canViewProfit = user?.permissions.has("reports.view_profit") ?? false;

  const metrics = canViewProfit ? [...BASE_METRICS, PROFIT_METRIC] : BASE_METRICS;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Panel</h1>
        <p className="text-muted-foreground text-sm">Bienvenida, {user?.name}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{metric.label}</CardTitle>
                <Badge variant="outline">Próximamente</Badge>
              </div>
              <CardDescription>{metric.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
