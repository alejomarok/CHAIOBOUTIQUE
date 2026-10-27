"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

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
import { authClient } from "@/lib/auth-client";
import { useFormReady } from "@/components/auth/use-form-ready";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/modules/auth/schemas";

export function ForgotPasswordForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isFormReady = useFormReady();
  // Always shown after submit, regardless of whether the email exists —
  // never confirm/deny account existence (see SECURITY.md).
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    if (isSubmitting || !isFormReady) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const { error } = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: "/reset-password",
      });
      if (error) {
        setErrorMessage(
          error.status === 403
            ? "No pudimos procesar la solicitud desde esta dirección. Ingresá desde el sitio oficial de ChaioBoutique."
            : error.status === 429
              ? "Recibimos demasiadas solicitudes. Esperá un minuto y volvé a intentar."
              : "No pudimos enviar las instrucciones. Intentá nuevamente en unos minutos.",
        );
        return;
      }
      setSubmitted(true);
    } catch {
      setErrorMessage("No pudimos conectar. Revisá tu conexión y volvé a intentar.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-muted-foreground text-sm">
        Si existe una cuenta con ese email, te enviamos instrucciones para restablecer tu
        contraseña.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {errorMessage && (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage}
          </p>
        )}
        <Button type="submit" disabled={!isFormReady || isSubmitting} className="mt-2">
          {isSubmitting ? "Enviando…" : "Enviar instrucciones"}
        </Button>
      </form>
    </Form>
  );
}
