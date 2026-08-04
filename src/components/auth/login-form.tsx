"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
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
import { resolvePostLoginDestinationAction } from "@/app/(auth)/login/actions";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { loginSchema, type LoginInput } from "@/modules/auth/schemas";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    // Defense in depth beyond `disabled={isSubmitting}` on the button: a
    // second submit landing in the gap before that re-render must not start
    // a second concurrent sign-in.
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const { error } = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });

      if (error) {
        // Generic on purpose: never confirm/deny whether the email exists.
        toast.error("No pudimos iniciar sesión. Revisá tu email y contraseña.");
        return;
      }

      // The server, never the client, decides the final destination: only it
      // knows the account's real permissions. `redirectTo` is passed through
      // untrusted — resolvePostLoginDestinationAction only honors it if it's
      // both same-origin-safe and a destination this account is actually
      // authorized for; otherwise it falls back to the role-based default.
      // See modules/auth/post-login-redirect.ts.
      const requestedRedirect = searchParams.get("redirectTo");
      let destination = "/";
      try {
        destination = await resolvePostLoginDestinationAction(requestedRedirect);
      } catch (destinationError) {
        // The account IS already signed in at this point (signIn.email
        // succeeded above) — a hiccup resolving *where* to send them must
        // never strand the user staring at a "loading" login form forever.
        // "/" is a safe destination any authenticated account can reach —
        // see isAuthorizedForPath's catch-all.
        console.error("Failed to resolve post-login destination.", destinationError);
        toast.error(
          "Iniciaste sesión, pero no pudimos calcular tu destino habitual. Te llevamos al inicio.",
        );
      }

      // replace, not push: signing in should not leave the login form as a
      // back-button destination for an already-authenticated session.
      // Deliberately no router.refresh() here: replace() already performs a
      // real navigation to `destination`, fetching that route's Server
      // Components fresh (including anything session-dependent, like
      // AdminShell's permission-gated nav) — an immediate refresh() call
      // races it, re-rendering the CURRENT (login) route's data instead of
      // letting the in-flight replace() transition land. That race was
      // invisible under mocked unit tests (router.replace/refresh are both
      // no-op mocks there) and only surfaced running this flow against a
      // real server, in e2e.
      router.replace(destination);
    } catch (signInError) {
      console.error("Sign-in request failed.", signInError);
      toast.error("No pudimos iniciar sesión. Intentá de nuevo.");
    } finally {
      // Always runs — including when signIn.email itself rejects (e.g. a
      // network failure) or resolvePostLoginDestinationAction's outer call
      // throws unexpectedly. This is what actually fixes the form getting
      // stuck on "Ingresando…" forever: previously nothing reset this flag
      // on an unhandled rejection.
      setIsSubmitting(false);
    }
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Contraseña</FormLabel>
                <Link
                  href="/forgot-password"
                  className="text-muted-foreground text-xs hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="mt-2">
          {isSubmitting ? "Ingresando…" : "Iniciar sesión"}
        </Button>
      </form>
    </Form>
  );
}
