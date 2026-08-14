"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// The public header's sign-out control — separate from components/layout/
// user-menu.tsx (the admin/POS dropdown's "Cerrar sesión" item), which
// redirects to /login and has no pending/error handling of its own; this one
// needs both (storefront visitors aren't always headed back to a login
// screen) so it isn't reused as-is here.
export function LogoutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    // Defense in depth beyond disabled={isSigningOut} on the button — same
    // reasoning as LoginForm's onSubmit guard.
    if (isSigningOut) return;
    setIsSigningOut(true);

    try {
      const { error } = await authClient.signOut();
      if (error) {
        toast.error("No pudimos cerrar la sesión. Intentá de nuevo.");
        return;
      }

      // push (not replace) + refresh: the same pair components/layout/
      // user-menu.tsx's own sign-out already uses. refresh() is what makes
      // the header's server-rendered auth state (AuthActions/DashboardLink)
      // reflect the now-anonymous session immediately, without a manual
      // reload — push() alone wouldn't re-run this route's Server
      // Components if the visitor signs out from a page whose URL Next
      // considers unchanged.
      router.push("/");
      router.refresh();
    } catch (signOutError) {
      console.error("Sign-out request failed.", signOutError);
      toast.error("No pudimos cerrar la sesión. Intentá de nuevo.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={isSigningOut} onClick={handleSignOut}>
      {isSigningOut ? "Cerrando sesión…" : "Cerrar sesión"}
    </Button>
  );
}
