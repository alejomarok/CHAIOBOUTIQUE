"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { minorUnitsToDisplay } from "@/lib/money";
import {
  getReferenceFieldLabel,
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS_ES,
} from "@/modules/sales/payment-labels";

import { registerSalePaymentAction } from "../actions";

const formSchema = z.object({
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amount: z.string().min(1, "Ingresá un importe."),
  reference: z.string().optional(),
  paidAt: z.string().optional(),
  notes: z.string().optional(),
});
type FormInput = z.infer<typeof formSchema>;

function todayLocalDateInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function RegisterPaymentDialog({
  saleId,
  remainingAmount,
}: {
  saleId: string;
  remainingAmount: bigint;
}) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Regenerated every time the dialog OPENS (not once per component mount —
  // the Dialog root stays mounted across opens/closes, so a mount-scoped
  // key would be silently reused across separate payments and get the
  // second one wrongly rejected as a duplicate). Stable for the duration of
  // one open session: a double-click or network retry of the SAME
  // submission attempt reuses this same value, so the server can recognize
  // and reject a duplicate rather than registering the payment twice — see
  // modules/sales/payment-core.ts's registerSalePayment.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      method: "CASH",
      amount: "",
      reference: "",
      paidAt: todayLocalDateInput(),
      notes: "",
    },
  });

  // useWatch, not form.watch(): the latter returns a plain function React
  // Compiler cannot safely memoize — see customer-form.tsx/
  // create-size-group-dialog.tsx for the same established pattern.
  const method = useWatch({ control: form.control, name: "method" });
  const referenceLabel = getReferenceFieldLabel(method);

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      await registerSalePaymentAction({
        saleId,
        method: values.method,
        amount: values.amount,
        reference: values.reference || undefined,
        paidAt: values.paidAt || undefined,
        notes: values.notes || undefined,
        idempotencyKey,
      });
      toast.success("Pago registrado correctamente.");
      form.reset({
        method: "CASH",
        amount: "",
        reference: "",
        paidAt: todayLocalDateInput(),
        notes: "",
      });
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos registrar el pago.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setIdempotencyKey(crypto.randomUUID());
        } else {
          form.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>Registrar pago</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground -mt-2 text-sm">
          Saldo pendiente: {minorUnitsToDisplay(remainingAmount)}
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Medio de pago</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MANUAL_PAYMENT_METHODS.map((methodOption) => (
                        <SelectItem key={methodOption} value={methodOption}>
                          {PAYMENT_METHOD_LABELS_ES[methodOption]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Importe</FormLabel>
                  <FormControl>
                    <Input placeholder="0,00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {referenceLabel && (
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{referenceLabel}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="paidAt"
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
              control={form.control}
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
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Registrando…" : "Registrar pago"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
