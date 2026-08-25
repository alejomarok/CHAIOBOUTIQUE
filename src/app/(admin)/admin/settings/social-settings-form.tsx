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

import { updateSocialSettingsAction } from "./actions";

// Mirrors the server action's own urlOrBlank validation (see actions.ts) —
// instant, field-scoped feedback instead of a round trip to discover a
// malformed URL. Blank is always valid (hides that icon); a non-blank
// value must be a real, well-formed URL.
const urlOrBlank = z.string().refine((value) => !value || z.url().safeParse(value).success, "URL inválida");

const formSchema = z.object({
  instagramUrl: urlOrBlank,
  facebookUrl: urlOrBlank,
  tiktokUrl: urlOrBlank,
});
type FormInput = z.infer<typeof formSchema>;

export function SocialSettingsForm({
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
      await updateSocialSettingsAction(values);
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
        <p className="text-muted-foreground text-xs">
          Dejá una red vacía para ocultarla del pie de página — no hace falta completar las tres.
        </p>
        <FormField
          control={form.control}
          name="instagramUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Instagram</FormLabel>
              <FormControl>
                <Input
                  placeholder="https://instagram.com/chaioboutique"
                  disabled={!canManage}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="facebookUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Facebook</FormLabel>
              <FormControl>
                <Input
                  placeholder="https://facebook.com/chaioboutique"
                  disabled={!canManage}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tiktokUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>TikTok</FormLabel>
              <FormControl>
                <Input placeholder="https://tiktok.com/@chaioboutique" disabled={!canManage} {...field} />
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
