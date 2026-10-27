"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogoutConfirmation } from "@/components/layout/logout-confirmation";

export function LogoutButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Cerrar sesión
      </Button>
      <LogoutConfirmation open={open} onOpenChange={setOpen} />
    </>
  );
}
