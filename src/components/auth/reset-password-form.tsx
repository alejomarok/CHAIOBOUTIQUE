"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
import { resetPasswordSchema, type ResetPasswordInput } from "@/modules/auth/schemas";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const tokenError = searchParams.get("error");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });

  if (tokenError || !token) {
    return (
      <p className="text-muted-foreground text-sm">
        Este enlace no es válido o ya expiró. Pedí un nuevo enlace desde{" "}
        <a href="/forgot-password" className="underline">
          recuperar contraseña
        </a>
        .
      </p>
    );
  }

  async function onSubmit(values: ResetPasswordInput) {
    setIsSubmitting(true);
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token: token as string,
    });
    setIsSubmitting(false);

    if (error) {
      toast.error("No pudimos actualizar tu contraseña. Pedí un nuevo enlace.");
      return;
    }

    toast.success("Tu contraseña se actualizó correctamente.");
    router.push("/login");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nueva contraseña</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="mt-2">
          {isSubmitting ? "Guardando…" : "Guardar nueva contraseña"}
        </Button>
      </form>
    </Form>
  );
}
