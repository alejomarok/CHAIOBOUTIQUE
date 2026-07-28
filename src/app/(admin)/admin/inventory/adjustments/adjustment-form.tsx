"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
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

import { createAdjustmentAction } from "./actions";

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  INITIAL_STOCK: "Carga de stock inicial",
  ADJUSTMENT_IN: "Ajuste positivo",
  ADJUSTMENT_OUT: "Ajuste negativo",
  DAMAGE: "Mercadería dañada",
  LOSS: "Mercadería perdida",
  INTERNAL_CORRECTION: "Corrección interna",
};

const formSchema = z.object({
  variantId: z.string().min(1, "Elegí una variante"),
  warehouseId: z.string().min(1, "Elegí un depósito"),
  movementType: z.enum([
    "INITIAL_STOCK",
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "DAMAGE",
    "LOSS",
    "INTERNAL_CORRECTION",
  ]),
  quantity: z.number().int().positive("La cantidad debe ser mayor a cero"),
  reason: z.string().min(1, "El motivo es obligatorio"),
  notes: z.string().optional(),
});
type FormInput = z.infer<typeof formSchema>;

export function AdjustmentForm({
  variants,
  warehouses,
}: {
  variants: { id: string; label: string }[];
  warehouses: { id: string; name: string }[];
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Generated once per mount, resubmitted on every attempt — a double-click
  // or network retry reuses the same key and is rejected as a duplicate
  // rather than double-applied. See modules/inventory/idempotency.ts.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      variantId: "",
      warehouseId: "",
      movementType: "INITIAL_STOCK",
      quantity: 1,
      reason: "",
      notes: "",
    },
  });

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      await createAdjustmentAction({ ...values, idempotencyKey });
      toast.success("Movimiento registrado.");
      form.reset();
    } catch {
      toast.error("No pudimos registrar el movimiento.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="variantId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Variante</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elegí un producto/variante" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {variants.map((variant) => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.label}
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
          name="warehouseId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Depósito</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elegí un depósito" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
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
          name="movementType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de movimiento</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
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
          name="quantity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cantidad</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.valueAsNumber)}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Motivo</FormLabel>
              <FormControl>
                <Input {...field} />
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
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? "Registrando…" : "Registrar movimiento"}
        </Button>
      </form>
    </Form>
  );
}
