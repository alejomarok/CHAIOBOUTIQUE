"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { recoverOrderAction } from "@/app/(public)/recover-order/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit">
      {pending ? "Enviando…" : "Recuperar pedido"}
    </Button>
  );
}
export function RecoveryForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState(recoverOrderAction, { message: "" });
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="requestId" value={requestId} />
      <div hidden>
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="recovery-email">Email de la compra</Label>
        <Input
          id="recovery-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="recovery-order">Número de pedido</Label>
        <Input id="recovery-order" name="orderCode" maxLength={80} placeholder="PED-…" required />
      </div>
      <Submit />
      {state.message && (
        <p role="status" className="leading-7">
          {state.message}
        </p>
      )}
    </form>
  );
}
