import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-lg font-semibold">Iniciar sesión</h1>
        <p className="text-muted-foreground text-sm">Accedé a tu cuenta.</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        ¿No tenés una cuenta?{" "}
        <Link href="/register" className="text-foreground underline">
          Registrate
        </Link>
      </p>
    </div>
  );
}
