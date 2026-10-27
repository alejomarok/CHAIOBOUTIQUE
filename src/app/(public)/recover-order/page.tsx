import { randomUUID } from "node:crypto";
import { RecoveryForm } from "@/components/orders/recovery-form";
export const metadata = { title: "Recuperar mi pedido", robots: { index: false, follow: false } };
export default function RecoverOrderPage() {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 px-5 py-16">
      <h1 className="font-heading text-4xl">Recuperar mi pedido</h1>
      <p className="text-muted-foreground leading-7">
        Ingresá los datos de tu compra para recibir el enlace de seguimiento por correo. No
        necesitás crear una cuenta.
      </p>
      <RecoveryForm requestId={randomUUID()} />
      <a
        className="inline-flex min-h-11 items-center underline"
        href="https://wa.me/5493571319469"
        target="_blank"
        rel="noopener noreferrer"
      >
        Necesito ayuda por WhatsApp
      </a>
    </div>
  );
}
