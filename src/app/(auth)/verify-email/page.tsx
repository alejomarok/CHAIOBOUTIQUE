import Link from "next/link";

import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/modules/auth";

export const metadata = { title: "Verificar email" };

// Keyed by Better Auth's own BASE_ERROR_CODES, surfaced via the
// ?error=CODE query param that GET /api/auth/verify-email appends to our
// fixed callbackURL on failure (see lib/auth-core.ts and
// modules/auth/verification.ts). Any unrecognized code falls back to a
// generic message rather than leaking the raw code to the user.
const ERROR_MESSAGES: Record<string, string> = {
  TOKEN_EXPIRED: "El enlace de verificación expiró. Pedí uno nuevo abajo.",
  INVALID_TOKEN: "El enlace de verificación no es válido. Pedí uno nuevo abajo.",
  USER_NOT_FOUND: "No pudimos verificar tu email. Pedí un nuevo enlace abajo.",
};
const DEFAULT_ERROR_MESSAGE = "No pudimos verificar tu email. Pedí un nuevo enlace abajo.";

interface VerifyEmailPageProps {
  searchParams: Promise<{ verified?: string; error?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { verified, error } = await searchParams;
  // Best-effort only: a visitor coming straight from the verification
  // email link, or one who isn't signed in at all, still gets the full
  // check-your-email/resend experience — this is purely to prefill the
  // resend form's email field for the common case of an already-signed-in,
  // just-registered customer.
  const user = await getCurrentUser();

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-heading text-lg font-semibold">No pudimos verificar tu email</h1>
          <p className="text-muted-foreground text-sm">
            {ERROR_MESSAGES[error] ?? DEFAULT_ERROR_MESSAGE}
          </p>
        </div>
        <ResendVerificationForm defaultEmail={user?.email} />
      </div>
    );
  }

  if (verified) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-heading text-lg font-semibold">Email confirmado</h1>
          <p className="text-muted-foreground text-sm">Ya podés usar tu cuenta normalmente.</p>
        </div>
        <Button asChild className="mt-2">
          <Link href="/catalog">Ir al catálogo</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-lg font-semibold">Revisá tu email</h1>
        <p className="text-muted-foreground text-sm">
          Te enviamos un enlace para confirmar tu cuenta. Hacé clic en el enlace del email para
          activarla. Si no te llegó, pedí uno nuevo abajo.
        </p>
      </div>
      <ResendVerificationForm defaultEmail={user?.email} />
    </div>
  );
}
