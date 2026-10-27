"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { navigateAfterLogout } from "@/lib/logout-navigation";

export function LogoutConfirmation({
  open,
  onOpenChange,
  destination = "/",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination?: "/" | "/login";
}) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pending = useRef(false);
  async function confirmLogout() {
    if (pending.current) return;
    pending.current = true;
    setErrorMessage(null);
    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error("Sign-out failed");
      navigateAfterLogout(destination);
    } catch {
      pending.current = false;
      setIsSigningOut(false);
      setErrorMessage("No pudimos cerrar la sesión. Intentá de nuevo.");
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!isSigningOut) {
          if (!value) setErrorMessage(null);
          onOpenChange(value);
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>¿Querés cerrar sesión?</DialogTitle>
          <DialogDescription>
            Vas a tener que iniciar sesión de nuevo para acceder a tu cuenta.
          </DialogDescription>
        </DialogHeader>
        {errorMessage && (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={isSigningOut}
            onClick={() => {
              setErrorMessage(null);
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={isSigningOut}
            onClick={confirmLogout}
          >
            {isSigningOut ? "Cerrando sesión…" : "Sí, cerrar sesión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
