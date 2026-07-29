import Link from "next/link";

import { RegisterForm } from "@/components/auth/register-form";

export const metadata = { title: "Crear cuenta" };

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-lg font-semibold">Crear cuenta</h1>
        <p className="text-muted-foreground text-sm">
          Registrate para gestionar tu perfil y tus direcciones.
        </p>
      </div>
      <RegisterForm />
      <p className="text-muted-foreground text-center text-sm">
        ¿Ya tenés una cuenta?{" "}
        <Link href="/login" className="text-foreground underline">
          Iniciá sesión
        </Link>
      </p>
    </div>
  );
}
