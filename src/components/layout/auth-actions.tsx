import Link from "next/link";

import { LogoutButton } from "@/components/layout/logout-button";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/modules/auth";

// Server Component, deliberately async and rendered with no client-side auth
// check of its own — same zero-hydration-flash pattern as components/layout/
// dashboard-link.tsx and cart-icon-link.tsx in this same header: the correct
// button is already in the first HTML the server sends, so there's no
// "Iniciar sesión" flash before it flips to "Cerrar sesión". getCurrentUser
// is React cache()-memoized per request (see modules/auth/session.ts), so
// this call costs nothing beyond DashboardLink's own call to it in the same
// render — never a second session/DB lookup.
export async function AuthActions() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Button asChild variant="outline">
        <Link href="/login">Iniciar sesión</Link>
      </Button>
    );
  }

  return <LogoutButton />;
}
