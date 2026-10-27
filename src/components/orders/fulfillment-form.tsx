"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateFulfillmentAction } from "@/app/(admin)/admin/orders/actions";
import type { OrderStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormReady } from "@/components/auth/use-form-ready";

export function FulfillmentForm({
  orderId,
  options,
}: {
  orderId: string;
  options: Array<{ value: OrderStatus; label: string }>;
}) {
  const router = useRouter();
  const ready = useFormReady();
  const [status, setStatus] = useState(options[0]?.value ?? "PROCESSING");
  const [pending, setPending] = useState(false);
  if (!options.length) return null;
  return (
    <form
      method="post"
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        try {
          await updateFulfillmentAction({
            orderId,
            status: status as "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "DELIVERED",
            carrier: String(data.get("carrier") ?? ""),
            trackingNumber: String(data.get("trackingNumber") ?? ""),
            trackingUrl: String(data.get("trackingUrl") ?? ""),
          });
          toast.success("Estado actualizado. La notificación quedó registrada.");
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "No pudimos actualizar el pedido.");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={!ready || pending} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="fulfillment-status">Próximo estado</Label>
          <select
            id="fulfillment-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as OrderStatus)}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-base"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {status === "SHIPPED" && (
          <>
            <div className="grid gap-2">
              <Label htmlFor="carrier">Transportista (opcional)</Label>
              <Input id="carrier" name="carrier" maxLength={120} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tracking-number">Código de seguimiento (opcional)</Label>
              <Input id="tracking-number" name="trackingNumber" maxLength={150} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tracking-url">Enlace de seguimiento (opcional)</Label>
              <Input
                id="tracking-url"
                name="trackingUrl"
                type="url"
                placeholder="https://…"
                maxLength={2048}
              />
            </div>
          </>
        )}
        <Button type="submit" className="min-h-11 justify-self-start" disabled={!ready || pending}>
          {pending ? "Guardando…" : "Actualizar entrega"}
        </Button>
      </fieldset>
    </form>
  );
}
