import { MessageCircle, RefreshCw, ShieldCheck, Truck } from "lucide-react";

const BENEFITS = [
  { icon: Truck, label: "Envíos", description: "Coordinamos el envío de tu pedido" },
  { icon: RefreshCw, label: "Cambios simples", description: "Sin vueltas, te acompañamos" },
  { icon: ShieldCheck, label: "Compra segura", description: "Pago protegido en todo momento" },
  { icon: MessageCircle, label: "Atención personalizada", description: "Estamos para ayudarte" },
];

export function BenefitsStrip() {
  return (
    <section className="border-border border-t border-b">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
        {BENEFITS.map(({ icon: Icon, label, description }) => (
          <div key={label} className="flex flex-col items-center gap-2 text-center sm:flex-row sm:items-start sm:text-left">
            <Icon className="text-accent-cyan size-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-muted-foreground text-xs">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
