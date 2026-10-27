"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { manageConsumerRequestAction } from "@/app/(admin)/admin/requests/actions";
import { Button } from "@/components/ui/button";

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="min-h-11" disabled={pending}>
      {pending ? "Guardando…" : "Guardar respuesta"}
    </Button>
  );
}
export function RequestManagementForm({ id }: { id: string }) {
  const [state, action] = useActionState(manageConsumerRequestAction, {});
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <label className="grid gap-2 text-sm">
        Estado
        <select name="status" className="bg-background min-h-11 rounded-md border px-3">
          <option value="PROCESSING">En gestión</option>
          <option value="RESOLVED">Resuelta</option>
          <option value="REJECTED">No corresponde (informar motivo)</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm">
        Respuesta para la persona solicitante
        <textarea
          name="resolution"
          rows={3}
          maxLength={2000}
          className="bg-background rounded-md border p-3 text-base"
        />
      </label>
      <p className="text-muted-foreground text-sm leading-6">
        Cerrar una solicitud envía la respuesta por email. No ejecuta un reembolso ni repone stock.
      </p>
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">Respuesta guardada.</p>}
      <div>
        <Save />
      </div>
    </form>
  );
}
