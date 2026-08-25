"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { createMercadoPagoCheckoutAction } from "./actions";

// Client-generated once per mount, resubmitted unchanged on retry — same
// convention as adjustment-form.tsx's own idempotencyKey (see this
// integration's idempotent-preference-creation policy for why this
// protects against a double-click/network retry). Never regenerated after
// a successful click: the browser navigates away to Mercado Pago
// immediately, so there is no "next click" on this component instance to
// worry about.
export function PayWithMercadoPagoButton({ token }: { token: string }) {
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const [isLoading, setIsLoading] = useState(false);

  async function handleClick() {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const result = await createMercadoPagoCheckoutAction({ token, idempotencyKey });
      // A real, full-page redirect to Checkout Pro — never a client-side
      // Mercado Pago SDK/Payment Brick (out of scope this phase). No
      // provider credentials are ever present in this component.
      window.location.href = result.checkoutUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos iniciar el pago. Intentá nuevamente.");
      setIsLoading(false);
    }
  }

  return (
    <Button type="button" onClick={handleClick} disabled={isLoading}>
      {isLoading ? "Abriendo Mercado Pago..." : "Pagar con Mercado Pago"}
    </Button>
  );
}
