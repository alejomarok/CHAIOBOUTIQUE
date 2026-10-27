"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitConsumerRequestAction } from "@/app/(public)/solicitudes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="min-h-11" disabled={!ready || pending}>
      {pending ? "Registrando…" : "Enviar solicitud"}
    </Button>
  );
}

export function ConsumerRequestForm({
  kind,
  requestId,
}: {
  kind: "WITHDRAWAL" | "EXCHANGE" | "PRIVACY";
  requestId: string;
}) {
  const [state, action] = useActionState(submitConsumerRequestAction, {});
  if (state.code)
    return (
      <div role="status" className="bg-muted p-6 leading-7">
        <h2 className="font-heading text-2xl">Recibimos tu solicitud</h2>
        <p className="mt-3">
          Tu número de constancia es <strong>{state.code}</strong>. Conservá este código. La
          constancia también te llegará al correo informado; puede demorar unos minutos.
        </p>
        <p className="mt-3">
          Te vamos a contactar para coordinar los próximos pasos. Si necesitás ayuda, escribinos al
          WhatsApp +54 9 3571 31-9469.
        </p>
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="request-name">Nombre y apellido</Label>
        <Input
          id="request-name"
          name="fullName"
          autoComplete="name"
          required
          minLength={2}
          maxLength={150}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="request-email">Email para responderte</Label>
        <Input
          id="request-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="request-phone">Teléfono (opcional)</Label>
        <Input id="request-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
      </div>
      {kind !== "PRIVACY" && (
        <div className="grid gap-2">
          <Label htmlFor="request-order">Número de pedido (si lo tenés)</Label>
          <Input id="request-order" name="orderCode" maxLength={80} placeholder="PED-…" />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="request-message">
          {kind === "PRIVACY"
            ? "Contanos qué derecho querés ejercer"
            : "Información adicional (opcional)"}
        </Label>
        <textarea
          id="request-message"
          name="message"
          maxLength={2000}
          rows={4}
          className="border-input bg-background rounded-md border px-3 py-2 text-base"
        />
      </div>
      <p className="text-sm leading-6">
        Usamos estos datos únicamente para gestionar tu solicitud. No te vamos a pedir claves, datos
        de tarjeta ni que crees una cuenta.
      </p>
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      <Submit ready={Boolean(requestId)} />
    </form>
  );
}
