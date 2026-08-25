"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  createArcaInvoicingIntentAction,
  registerExternalInvoiceAction,
  registerManualInvoiceAction,
} from "../actions";

// Same "YYYY-MM-DD in local time" convention as register-payment-dialog.tsx.
function todayLocalDateInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

type Step = "choose" | "manual" | "external" | "arca";

const manualSchema = z.object({
  documentType: z.string().min(1, "Ingresá el tipo de comprobante."),
  pointOfSale: z.string().min(1, "Ingresá el punto de venta."),
  documentNumber: z.string().min(1, "Ingresá el número de comprobante."),
  issueDate: z.string().min(1, "Ingresá la fecha."),
  totalAmount: z.string().min(1, "Ingresá el importe."),
  notes: z.string().optional(),
});
type ManualFormInput = z.infer<typeof manualSchema>;

const externalSchema = z.object({
  documentType: z.string().min(1, "Ingresá el tipo de comprobante."),
  pointOfSale: z.string().optional(),
  documentNumber: z.string().min(1, "Ingresá el número de comprobante."),
  issueDate: z.string().min(1, "Ingresá la fecha."),
  totalAmount: z.string().min(1, "Ingresá el importe."),
  sourceSystem: z.string().min(1, "Ingresá el sistema de origen."),
  externalReference: z.string().optional(),
  notes: z.string().optional(),
});
type ExternalFormInput = z.infer<typeof externalSchema>;

// Step 1: "¿Cómo se facturó esta venta?" -> step 2: the real, mode-specific
// data-entry form — see this phase's explicit "avoid one giant form with
// irrelevant fields" requirement. `saleTotalAmountDisplay`/
// `defaultPointOfSale` arrive already display-formatted strings from the
// parent Server Component — a raw bigint must never cross this boundary
// (see lib/money.ts's own documented rule).
export function RegisterInvoiceDialog({
  saleId,
  saleTotalAmountDisplay,
  defaultPointOfSale,
  arcaDataReady,
}: {
  saleId: string;
  saleTotalAmountDisplay: string;
  defaultPointOfSale?: string | null;
  // Phase — ARCA Fiscal Readiness + Tax Model. Computed server-side by the
  // parent page via arca/readiness-core.ts's getArcaDataReadiness — never
  // recomputed client-side. Only ever changes WHICH message is shown; the
  // "Registrar intención" action itself is unchanged (still only ever
  // creates a PENDING intent, still enforced server-side by
  // createArcaInvoicingIntent's own ArcaDataNotReadyError gate either way).
  arcaDataReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Regenerated every time the dialog OPENS — same convention as
  // register-payment-dialog.tsx's own idempotencyKey (the Dialog root stays
  // mounted across opens/closes, so a mount-scoped key would be silently
  // reused across separate registration attempts).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const manualForm = useForm<ManualFormInput>({
    resolver: zodResolver(manualSchema),
    defaultValues: {
      documentType: "",
      pointOfSale: defaultPointOfSale ?? "",
      documentNumber: "",
      issueDate: todayLocalDateInput(),
      totalAmount: saleTotalAmountDisplay,
      notes: "",
    },
  });

  const externalForm = useForm<ExternalFormInput>({
    resolver: zodResolver(externalSchema),
    defaultValues: {
      documentType: "",
      pointOfSale: "",
      documentNumber: "",
      issueDate: todayLocalDateInput(),
      totalAmount: saleTotalAmountDisplay,
      sourceSystem: "Sistema anterior",
      externalReference: "",
      notes: "",
    },
  });

  function resetAll() {
    setStep("choose");
    manualForm.reset();
    externalForm.reset();
  }

  async function onSubmitManual(values: ManualFormInput) {
    setIsSubmitting(true);
    try {
      await registerManualInvoiceAction({ saleId, ...values, idempotencyKey });
      toast.success("Comprobante manual registrado.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos registrar la facturación.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmitExternal(values: ExternalFormInput) {
    setIsSubmitting(true);
    try {
      await registerExternalInvoiceAction({ saleId, ...values, idempotencyKey });
      toast.success("Facturación en sistema externo registrada.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos registrar la facturación.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onConfirmArca() {
    setIsSubmitting(true);
    try {
      await createArcaInvoicingIntentAction({ saleId, idempotencyKey });
      toast.success("Se registró la intención de facturación electrónica.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos registrar la facturación.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setIdempotencyKey(crypto.randomUUID());
        resetAll();
      }}
    >
      <DialogTrigger asChild>
        <Button>Registrar facturación</Button>
      </DialogTrigger>
      <DialogContent>
        {step === "choose" && (
          <>
            <DialogHeader>
              <DialogTitle>¿Cómo se facturó esta venta?</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => setStep("arca")}
              >
                Electrónicamente con ARCA
              </Button>
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => setStep("manual")}
              >
                Manualmente
              </Button>
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => setStep("external")}
              >
                En el sistema anterior
              </Button>
            </div>
          </>
        )}

        {step === "arca" && (
          <>
            <DialogHeader>
              <DialogTitle>Facturación electrónica ARCA</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">
              La integración electrónica con ARCA todavía no está habilitada. Podés registrar la
              intención de facturar esta venta electrónicamente — va a quedar pendiente hasta que la
              integración esté disponible. No se genera CAE ni número de factura todavía.
            </p>
            <p className="text-sm font-medium">
              {arcaDataReady
                ? "Datos fiscales listos. Falta configurar la conexión con ARCA."
                : "Falta completar la configuración fiscal."}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("choose")}
                disabled={isSubmitting}
              >
                Volver
              </Button>
              <Button type="button" onClick={onConfirmArca} disabled={isSubmitting || !arcaDataReady}>
                {isSubmitting ? "Registrando…" : "Registrar intención"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "manual" && (
          <>
            <DialogHeader>
              <DialogTitle>Comprobante manual</DialogTitle>
            </DialogHeader>
            <Form {...manualForm}>
              <form onSubmit={manualForm.handleSubmit(onSubmitManual)} className="flex flex-col gap-4">
                <FormField
                  control={manualForm.control}
                  name="documentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de comprobante</FormLabel>
                      <FormControl>
                        <Input placeholder="Factura B" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={manualForm.control}
                  name="pointOfSale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Punto de venta</FormLabel>
                      <FormControl>
                        <Input placeholder="0004" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={manualForm.control}
                  name="documentNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número de comprobante</FormLabel>
                      <FormControl>
                        <Input placeholder="00001234" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={manualForm.control}
                  name="issueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={manualForm.control}
                  name="totalAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total</FormLabel>
                      <FormControl>
                        <Input placeholder="0,00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={manualForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notas (opcional)</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep("choose")}
                    disabled={isSubmitting}
                  >
                    Volver
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Registrando…" : "Registrar comprobante"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}

        {step === "external" && (
          <>
            <DialogHeader>
              <DialogTitle>Facturado en sistema externo</DialogTitle>
            </DialogHeader>
            <Form {...externalForm}>
              <form
                onSubmit={externalForm.handleSubmit(onSubmitExternal)}
                className="flex flex-col gap-4"
              >
                <FormField
                  control={externalForm.control}
                  name="sourceSystem"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sistema de origen</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={externalForm.control}
                  name="documentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de comprobante</FormLabel>
                      <FormControl>
                        <Input placeholder="Factura B" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={externalForm.control}
                  name="pointOfSale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Punto de venta (opcional)</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={externalForm.control}
                  name="documentNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número de comprobante</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={externalForm.control}
                  name="issueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={externalForm.control}
                  name="totalAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total</FormLabel>
                      <FormControl>
                        <Input placeholder="0,00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={externalForm.control}
                  name="externalReference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Referencia externa (opcional)</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={externalForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notas (opcional)</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep("choose")}
                    disabled={isSubmitting}
                  >
                    Volver
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Registrando…" : "Registrar comprobante"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
