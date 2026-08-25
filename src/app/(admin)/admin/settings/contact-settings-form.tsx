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

import { updateContactSettingsAction } from "./actions";

// Mirrors the server action's own email validation (see actions.ts) —
// instant, field-scoped feedback instead of a round trip. Phone/WhatsApp
// stay free text (no single format fits every valid Argentine number
// shape); blank is always valid for every field here.
const formSchema = z.object({
  publicPhone: z.string(),
  whatsappPhone: z.string(),
  publicEmail: z.string().refine((value) => !value || z.email().safeParse(value).success, "Email inválido"),
});
type FormInput = z.infer<typeof formSchema>;

export function ContactSettingsForm({
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
      await updateContactSettingsAction(values);
      toast.success("Configuración actualizada correctamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos guardar los cambios.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="publicPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Teléfono</FormLabel>
              <FormControl>
                <Input placeholder="03571 123456" disabled={!canManage} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="whatsappPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>WhatsApp</FormLabel>
              <FormControl>
                <Input placeholder="+54 9 3571 123456" disabled={!canManage} {...field} />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Puede ser distinto del teléfono. Se usa para el botón de WhatsApp del pie de página.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="publicEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo electrónico</FormLabel>
              <FormControl>
                <Input type="email" placeholder="hola@chaioboutique.com" disabled={!canManage} {...field} />
              </FormControl>
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
