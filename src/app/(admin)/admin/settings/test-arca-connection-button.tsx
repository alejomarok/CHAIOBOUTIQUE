"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { testArcaConnectionAction } from "./actions";

// Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration. Read-only —
// never creates a FiscalDocument. Shown only when the readiness card's own
// connection check is already green (see arca-readiness-card.tsx), so a
// failure here always means something ELSE (real network issue, a
// misconfigured/expired real certificate content, ARCA's own homologation
// service being down) — surfaced verbatim via toast, same posture as every
// other admin action's error handling in this codebase.
export function TestArcaConnectionButton() {
  const [isTesting, setIsTesting] = useState(false);

  async function handleClick() {
    setIsTesting(true);
    try {
      const result = await testArcaConnectionAction();
      toast.success(
        `Conexión con ARCA (Homologación) OK — WSFEv1: ${result.appServer}/${result.dbServer}/${result.authServer}. ` +
          `Punto de venta ${result.pointOfSale}, último comprobante Factura C autorizado: ${result.lastAuthorizedVoucherFacturaC}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos probar la conexión con ARCA.");
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={isTesting}>
      {isTesting ? "Probando conexión…" : "Probar conexión con ARCA"}
    </Button>
  );
}
