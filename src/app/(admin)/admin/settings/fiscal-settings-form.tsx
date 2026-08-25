"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
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
import { FISCAL_TAX_CATEGORY_LABELS_ES } from "@/modules/fiscal-documents/arca/fiscal-tax-category-core";
import {
  ARCA_ENVIRONMENT_LABELS_ES,
  ISSUER_VAT_CONDITION_LABELS_ES,
} from "@/modules/fiscal-documents/arca/vat-condition-labels";

import { updateFiscalSettingsAction } from "./actions";

const formSchema = z.object({
  fiscalLegalName: z.string(),
  fiscalTaxId: z.string(),
  fiscalDefaultPointOfSale: z.string(),
  // Matches app/(admin)/admin/settings/actions.ts's own enums exactly.
  issuerVatCondition: z.enum(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTISTA", "EXENTO", ""]),
  fiscalAddress: z.string(),
  fiscalActivityStartDate: z.string(),
  fiscalGrossIncomeId: z.string(),
  arcaPointOfSale: z.string(),
  arcaEnvironment: z.enum(["HOMOLOGATION", "PRODUCTION", ""]),
  defaultTaxCategory: z.enum(["IVA_21", "IVA_10_5", "IVA_27", "IVA_5", "IVA_2_5", "IVA_0", "EXENTO", ""]),
});
type FormInput = z.infer<typeof formSchema>;

export function FiscalSettingsForm({
  defaultValues,
  canManage,
}: {
  defaultValues: FormInput;
  canManage: boolean;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  async function onSubmit(values: FormInput) {
    setIsSubmitting(true);
    try {
      await updateFiscalSettingsAction(values);
      toast.success("Configuración fiscal actualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos guardar los cambios.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <p className="text-muted-foreground -mt-1 text-xs font-medium tracking-wide uppercase">
          Datos del emisor
        </p>
        <FormField
          control={form.control}
          name="fiscalLegalName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Razón social</FormLabel>
              <FormControl>
                <Input placeholder="CHAIOBOUTIQUE S.R.L." disabled={!canManage} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="fiscalTaxId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>CUIT</FormLabel>
              <FormControl>
                <Input placeholder="30-12345678-9" disabled={!canManage} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="issuerVatCondition"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Condición frente al IVA</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={!canManage}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sin configurar" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(ISSUER_VAT_CONDITION_LABELS_ES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Determina qué tipo de comprobante (A/B/C) puede emitir la tienda. No se asume ningún
                valor por defecto.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="fiscalAddress"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Domicilio fiscal/comercial (opcional)</FormLabel>
              <FormControl>
                <Input disabled={!canManage} {...field} />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Solo se usa para un futuro comprobante impreso — no forma parte de la solicitud a
                ARCA.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="fiscalActivityStartDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Inicio de actividades (opcional)</FormLabel>
              <FormControl>
                <Input type="date" disabled={!canManage} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="fiscalGrossIncomeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ingresos Brutos (opcional)</FormLabel>
              <FormControl>
                <Input disabled={!canManage} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <p className="text-muted-foreground mt-2 -mb-1 text-xs font-medium tracking-wide uppercase">
          Facturación electrónica ARCA
        </p>
        <FormField
          control={form.control}
          name="fiscalDefaultPointOfSale"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Punto de venta predeterminado (comprobantes manuales)</FormLabel>
              <FormControl>
                <Input placeholder="0004" disabled={!canManage} {...field} />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Se usa para pre-completar el formulario de comprobante manual — siempre editable.
                Nunca se reutiliza como punto de venta electrónico.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="arcaPointOfSale"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Punto de venta electrónico (ARCA)</FormLabel>
              <FormControl>
                <Input placeholder="1" inputMode="numeric" disabled={!canManage} {...field} />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Número entre 1 y 99998 (WSFEv1 admite hasta 5 dígitos), distinto del punto de venta
                manual de arriba. Se guarda como número — el relleno con ceros a la izquierda solo se
                aplica al mostrarlo en un comprobante.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="arcaEnvironment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Entorno de ARCA</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={!canManage}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sin configurar" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(ARCA_ENVIRONMENT_LABELS_ES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Nunca se infiere automáticamente — elegilo explícitamente antes de cualquier prueba.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <p className="text-muted-foreground mt-2 -mb-1 text-xs font-medium tracking-wide uppercase">
          Catálogo
        </p>
        <FormField
          control={form.control}
          name="defaultTaxCategory"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Categoría fiscal por defecto</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={!canManage}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sin configurar" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(FISCAL_TAX_CATEGORY_LABELS_ES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Se usa para los productos que no tengan una categoría fiscal propia configurada. Un
                producto individual siempre puede anular este valor. Esto no constituye asesoramiento
                contable ni impositivo — confirmá la categoría correcta con tu contador antes de
                configurarla.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        {canManage ? (
          <Button type="submit" disabled={isSubmitting} className="mt-2 self-start">
            {isSubmitting ? "Guardando…" : "Guardar cambios"}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            No tenés permiso para modificar la configuración.
          </p>
        )}
      </form>
    </Form>
  );
}
