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
import { Textarea } from "@/components/ui/textarea";

import { updateDeliverySettingsAction } from "./actions";

const formSchema = z.object({
  homeDeliveryPostalCodes: z.string().max(1000),
  homeDeliveryEstimate: z.string().max(200),
  homeDeliveryFlatFeeAmount: z.string(),
  pickupInstructions: z.string(),
});
type FormInput = z.infer<typeof formSchema>;

export function DeliverySettingsForm({
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
      await updateDeliverySettingsAction(values);
      toast.success("Configuración de entrega actualizada.");
    } catch {
      toast.error("No pudimos guardar los cambios.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="homeDeliveryPostalCodes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Códigos postales con envío</FormLabel>
              <FormControl>
                <Input {...field} disabled={!canManage} placeholder="5856, 5850" />
              </FormControl>
              <p className="text-muted-foreground text-sm">
                Separá los códigos cubiertos por comas. Fuera de esta lista se ofrece retiro.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="homeDeliveryEstimate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Plazo estimado de entrega</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled={!canManage}
                  placeholder="Indicá el plazo que realmente podés cumplir"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="homeDeliveryFlatFeeAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Costo de envío a domicilio</FormLabel>
              <FormControl>
                <Input placeholder="0,00" disabled={!canManage} {...field} />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Dejalo vacío para no ofrecer envío a domicilio en el checkout — solo se mostrará
                retiro en el local. Nunca se inventa un costo.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="pickupInstructions"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Instrucciones de retiro (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Dirección y horarios para retirar el pedido."
                  disabled={!canManage}
                  {...field}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Se muestra en el checkout cuando el cliente elige retiro. Si queda vacío, se muestra
                un mensaje genérico en su lugar.
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
