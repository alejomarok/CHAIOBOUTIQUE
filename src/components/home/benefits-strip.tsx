import { MessageCircle, PackageCheck, ShieldCheck, Truck } from "lucide-react";

const BENEFITS = [
  { icon: Truck, label: "Tu pedido, cerca tuyo", description: "Coordinamos el envío con vos." },
  {
    icon: PackageCheck,
    label: "Elegí con tranquilidad",
    description: "Te asesoramos con talles y prendas.",
  },
  {
    icon: ShieldCheck,
    label: "Compra protegida",
    description: "Pagá de forma segura con Mercado Pago.",
  },
  {
    icon: MessageCircle,
    label: "De persona a persona",
    description: "Estamos para ayudarte a elegir.",
  },
];

export function BenefitsStrip() {
  return (
    <section aria-label="Tu experiencia de compra" className="bg-background py-14 sm:py-16">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-8 px-6 sm:grid-cols-2 sm:px-10 lg:grid-cols-4 lg:gap-10 lg:px-16">
        {BENEFITS.map(({ icon: Icon, label, description }) => (
          <div data-reveal key={label} className="flex items-start gap-4">
            <Icon
              className="text-primary mt-0.5 size-6 shrink-0"
              strokeWidth={1.3}
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-muted-foreground mt-2 text-[13px] leading-6">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
