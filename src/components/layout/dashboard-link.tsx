import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getCurrentUser, resolvePostLoginDestination } from "@/modules/auth";

// Server Component, deliberately async and rendered with no client-side
// auth check of its own (no useEffect/useState) — the button is either
// present or absent in the very first HTML the server sends, so there is no
// hydration mismatch and therefore no flash. See components/layout/
// cart-icon-link.tsx for the identical pattern already used in this header.
//
// Reuses resolvePostLoginDestination (modules/auth/post-login-redirect.ts)
// rather than re-deriving the admin.access/pos.access priority here a
// second time — that function already never returns "/account" (it has no
// branch for it at all), so this needs no extra guard for that. Every
// check it makes is a named permission or the CUSTOMER role, read from the
// real server-side session — never a permission count, an email, or
// anything client-supplied.
export async function DashboardLink() {
  const user = await getCurrentUser();
  if (!user) return null;

  const destination = resolvePostLoginDestination(user);

  if (destination === "/admin") {
    return (
      <Button asChild size="sm">
        <Link href="/admin">Ir al panel</Link>
      </Button>
    );
  }

  if (destination === "/pos") {
    return (
      <Button asChild size="sm">
        <Link href="/pos">Ir al POS</Link>
      </Button>
    );
  }

  // CUSTOMER (verified or not) and any other authenticated-but-unrecognized
  // account resolve to "/catalog", "/verify-email" or "/" — none of which
  // is a staff dashboard, so no button renders. The existing catalog/cart
  // controls elsewhere in the header are untouched.
  return null;
}
