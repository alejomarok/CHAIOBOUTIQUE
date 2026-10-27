// Pure constants — no "server-only", no DB import — importable from both
// Server Components/Actions and Client Components (the payment form and
// payment history list need these client-side too). Centralized here rather
// than duplicated per-file: unlike SaleStatus's labels (defined locally in
// just the 2 existing sales pages), payment method/status labels are needed
// in the sales list, the sale detail page, the registration form, and the
// payment history list — worth one shared source instead of 4 copies.
import type { PaymentMethod } from "@/generated/prisma/client";

import type { SalePaymentStatusValue } from "./totals";

// Every method the admin "Registrar pago" form may submit — MERCADO_PAGO is
// deliberately excluded (see the SalePayment model's schema comment): it
// exists in the DB enum for a future webhook integration, but manually
// selecting it here would misrepresent an unverified entry as a real
// provider transaction. Defined here (not payment-core.ts) specifically so
// client components (the registration form) can import it without pulling
// in payment-core.ts's Prisma/db dependencies.
export const MANUAL_PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "OTHER",
] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHOD_LABELS_ES: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  BANK_TRANSFER: "Transferencia",
  DEBIT_CARD: "Tarjeta de débito",
  CREDIT_CARD: "Tarjeta de crédito",
  OTHER: "Otro",
  // Not offered in the manual registration form — see
  // modules/sales/payment-core.ts's MANUAL_PAYMENT_METHODS — but a label is
  // still needed here so payment history can render it correctly once a
  // future Mercado Pago webhook integration starts writing this method.
  MERCADO_PAGO: "Mercado Pago",
};

export const PAYMENT_STATUS_LABELS_ES: Record<SalePaymentStatusValue, string> = {
  UNPAID: "Sin pagar",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagada",
  PARTIALLY_REFUNDED: "Reembolso parcial",
  REFUNDED: "Reembolsada",
  CHARGED_BACK: "Contracargo",
};

// Same restrained 3-variant vocabulary as SaleStatus's own badge mapping in
// the sales list/detail pages (outline = nothing done yet, secondary = an
// in-between state, default = the fully-achieved positive state) — kept
// consistent rather than inventing a fourth "warning" color, per this
// project's established no-hardcoded-alarm-colors convention.
export const PAYMENT_STATUS_BADGE_VARIANT: Record<
  SalePaymentStatusValue,
  "default" | "outline" | "secondary"
> = {
  UNPAID: "outline",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  PARTIALLY_REFUNDED: "secondary",
  REFUNDED: "secondary",
  CHARGED_BACK: "secondary",
};

// Reference/comprobante field is only shown for methods where it's actually
// meaningful — see this phase's own "do not show irrelevant fields" UI
// requirement. CASH: never useful, hidden entirely. Everything else: shown,
// with a method-specific placeholder/label.
export function getReferenceFieldLabel(method: PaymentMethod): string | null {
  switch (method) {
    case "CASH":
      return null;
    case "BANK_TRANSFER":
      return "Referencia / número de operación";
    default:
      return "Referencia (opcional)";
  }
}
