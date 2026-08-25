"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  issueElectronicInvoiceAction,
  reconcileArcaFiscalDocumentAction,
  type ArcaIssuanceResultDTO,
} from "../actions";
import type { FiscalDocumentStatus } from "@/generated/prisma/client";

// Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration. Rendered by
// the parent page whenever the active FiscalDocument is ELECTRONICA_ARCA,
// REGARDLESS of status (see page.tsx's own comment on why): a successful
// issueElectronicInvoiceAction revalidates the Sale detail page, which
// would recompute `currentStatus` to ISSUED and — if this component were
// only conditionally mounted for PENDING/ERROR — unmount it mid-
// interaction, destroying the very "show the CAE result" state it just
// set. Trigger visibility is instead decided HERE, from `currentStatus`
// AND local `result` state (so a just-completed issuance keeps showing its
// result panel even after the parent's props say ISSUED now).
//
// A genuinely real WSAA/WSFEv1 call, never a simulation — the confirmation
// dialog says so explicitly. Every result this dialog can show is real,
// unfabricated ARCA data (see issue-electronic-invoice-core.ts) — see this
// dialog's own "HOMOLOGACIÓN" watermark, which must never be mistaken for
// a real production document.
export function IssueArcaInvoiceDialog({
  saleId,
  fiscalDocumentId,
  currentStatus,
}: {
  saleId: string;
  fiscalDocumentId: string;
  currentStatus: FiscalDocumentStatus;
}) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ArcaIssuanceResultDTO | null>(null);
  const [uncertain, setUncertain] = useState(false);

  const isRetryAfterRejection = currentStatus === "ERROR";
  const canOfferTrigger = Boolean(result) || currentStatus === "PENDING" || currentStatus === "ERROR";
  if (!canOfferTrigger) return null;

  async function handleConfirm() {
    setIsSubmitting(true);
    setUncertain(false);
    try {
      const issued = await issueElectronicInvoiceAction(saleId);
      setResult(issued);
      if (issued.status === "ISSUED") {
        toast.success("Comprobante emitido en ARCA (Homologación).");
      } else if (issued.status === "ERROR") {
        toast.error("ARCA rechazó el comprobante. Revisá el detalle.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No pudimos emitir el comprobante.";
      // Server Actions only ever surface a plain Error with a message
      // across the boundary (never the original class/name) — matching on
      // ArcaIssuanceUncertainError's own distinctive message text is the
      // only way this Client Component can tell "uncertain, verify before
      // retrying" apart from every other rejection.
      if (message.includes("Verificar estado en ARCA")) {
        setUncertain(true);
      }
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReconcile() {
    setIsSubmitting(true);
    try {
      const reconciled = await reconcileArcaFiscalDocumentAction(fiscalDocumentId, saleId);
      setResult(reconciled);
      setUncertain(false);
      if (reconciled.status === "ISSUED") {
        toast.success("ARCA confirmó la emisión del comprobante.");
      } else {
        toast.message("ARCA no tiene ese comprobante autorizado — podés reintentar la emisión.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos verificar el estado en ARCA.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setUncertain(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{isRetryAfterRejection ? "Reintentar emisión en ARCA" : "Emitir en ARCA — Homologación"}</Button>
      </DialogTrigger>
      <DialogContent>
        {!result && !uncertain && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Emitir en ARCA
                <Badge variant="destructive">HOMOLOGACIÓN</Badge>
              </DialogTitle>
              <DialogDescription>
                Esta acción va a conectar con el servicio de Homologación de ARCA (entorno de pruebas) y va a
                solicitar un CAE real para este comprobante. No es una simulación: va a consumir un número de
                comprobante correlativo real en el entorno de Homologación de ARCA. Este comprobante NO tiene
                validez fiscal real — es exclusivamente para homologación y pruebas, nunca para producción.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={isSubmitting}>
                {isSubmitting ? "Emitiendo…" : "Confirmar emisión"}
              </Button>
            </DialogFooter>
          </>
        )}

        {uncertain && !result && (
          <>
            <DialogHeader>
              <DialogTitle>No pudimos confirmar el resultado</DialogTitle>
              <DialogDescription>
                Hubo una falla de red al esperar la respuesta de ARCA. No sabemos si el comprobante fue
                autorizado o no — verificá el estado antes de volver a intentar, para no arriesgar una doble
                solicitud.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
                Cerrar
              </Button>
              <Button type="button" onClick={handleReconcile} disabled={isSubmitting}>
                {isSubmitting ? "Verificando…" : "Verificar estado en ARCA"}
              </Button>
            </DialogFooter>
          </>
        )}

        {result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {result.status === "ISSUED" ? "Comprobante emitido" : "ARCA rechazó el comprobante"}
                {result.arcaEnvironment === "HOMOLOGATION" && <Badge variant="destructive">HOMOLOGACIÓN</Badge>}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">Entorno</p>
                <p>{result.arcaEnvironment === "HOMOLOGATION" ? "Homologación" : (result.arcaEnvironment ?? "—")}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Tipo</p>
                <p>{result.documentType ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Punto de venta</p>
                <p>{result.pointOfSale ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Número</p>
                <p>{result.documentNumber ?? "—"}</p>
              </div>
              {result.status === "ISSUED" && (
                <>
                  <div>
                    <p className="text-muted-foreground text-xs">CAE</p>
                    <p className="font-mono">{result.cae}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Vencimiento CAE</p>
                    <p>{result.caeExpiresAt && new Date(result.caeExpiresAt).toLocaleDateString("es-AR")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Fecha</p>
                    <p>{result.issueDate && new Date(result.issueDate).toLocaleDateString("es-AR")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total</p>
                    <p>{result.totalAmountDisplay}</p>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Cerrar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
