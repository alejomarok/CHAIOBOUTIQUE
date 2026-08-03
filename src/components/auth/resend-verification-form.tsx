"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { resendVerificationEmailAction } from "@/app/(auth)/verify-email/actions";
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
import { resendVerificationSchema, type ResendVerificationInput } from "@/modules/auth/schemas";

// The Server Action's response is intentionally only ever "sent" or
// "cooldown" — never "no such account" / "already verified" — so this
// component has no branch that could leak account existence either. Both
// outcomes render a calm, generic confirmation; "cooldown" additionally
// disables another immediate resend, which — combined with disabling the
// button for the duration of the request itself — is what prevents both a
// repeated-click flood and a concurrent duplicate send.
export function ResendVerificationForm({ defaultEmail }: { defaultEmail?: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<"sent" | "cooldown" | null>(null);

  const form = useForm<ResendVerificationInput>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: defaultEmail ?? "" },
  });

  async function onSubmit(values: ResendVerificationInput) {
    setIsSubmitting(true);
    const response = await resendVerificationEmailAction(values);
    setIsSubmitting(false);
    setResult(response.status);
  }

  if (result === "sent") {
    return (
      <p className="text-muted-foreground text-sm">
        Si tu cuenta existe y todavía no confirmaste tu email, te enviamos un nuevo enlace.
      </p>
    );
  }

  if (result === "cooldown") {
    return (
      <p className="text-muted-foreground text-sm">
        Ya pedimos un enlace hace poco. Esperá unos minutos antes de volver a intentar.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
        <Button type="submit" disabled={isSubmitting} className="mt-2">
          {isSubmitting ? "Enviando…" : "Reenviar enlace de verificación"}
        </Button>
      </form>
    </Form>
  );
}
