import { MessageCircle, RefreshCw, ShieldCheck, Truck } from "lucide-react";

const BENEFITS = [
  {
    icon: Truck,
    label: "Envíos",
    description: "Coordinamos el envío de tu pedido",
  },
  {
    icon: RefreshCw,
    label: "Cambios simples",
    description: "Te acompañamos durante todo el proceso",
  },
  {
    icon: ShieldCheck,
    label: "Compra segura",
    description: "Tu compra y tus datos están protegidos",
  },
  {
    icon: MessageCircle,
    label: "Atención personalizada",
    description: "Estamos para ayudarte cuando lo necesites",
  },
];

export function BenefitsStrip() {
  return (
    <section className="bg-[#fffdfb] py-10 sm:py-12">
      <div className="mx-auto grid max-w-[1380px] grid-cols-2 gap-x-4 gap-y-8 px-5 sm:px-8 md:grid-cols-4 lg:px-10">
        {BENEFITS.map(({ icon: Icon, label, description }, index) => (
          <div
            key={label}
            className={`flex flex-col items-center gap-3 text-center md:flex-row md:items-start md:text-left ${
              index > 0 ? "md:border-l md:border-[#eaded7] md:pl-7" : ""
            }`}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f7e3dc] text-[#a97063]">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[#433a36]">{label}</p>
              <p className="mt-1 max-w-[220px] text-xs leading-5 text-[#81756f]">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
