import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-lg font-semibold">Recuperar contraseña</h1>
        <p className="text-muted-foreground text-sm">
          Ingresá tu email y te enviamos instrucciones para restablecerla.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
