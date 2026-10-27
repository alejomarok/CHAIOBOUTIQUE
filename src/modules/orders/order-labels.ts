// Pure constants — no "server-only", no DB import — importable from both
// Server Components/Actions and Client Components. Never expose internal
// enum names directly in the UI (this phase's own explicit requirement) —
// every surface that shows an Order/payment status or delivery method reads
// from here, never a raw enum value.
import type {
  DeliveryMethod,
  OrderPaymentStatus,
  OrderStatus,
  PaymentAttemptStatus,
} from "@/generated/prisma/client";

export const ORDER_STATUS_LABELS_ES: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado",
  PROCESSING: "En preparación",
  READY_FOR_PICKUP: "Listo para retirar",
  SHIPPED: "Enviado",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
  EXPIRED: "Vencido",
};

// Restrained, same 3-variant vocabulary as SaleStatus/SalePaymentStatus's
// own badge mappings (outline = nothing happened yet, default = an
// in-progress-or-successful state, secondary = a terminal, non-alarming
// negative state) — never a 5-tier color gradient across the whole
// lifecycle, never a hardcoded alarm color.
export const ORDER_STATUS_BADGE_VARIANT: Record<OrderStatus, "default" | "outline" | "secondary"> =
  {
    PENDING_PAYMENT: "outline",
    PAID: "default",
    PROCESSING: "default",
    READY_FOR_PICKUP: "default",
    SHIPPED: "default",
    DELIVERED: "default",
    CANCELLED: "secondary",
    EXPIRED: "secondary",
  };

export const ORDER_PAYMENT_STATUS_LABELS_ES: Record<OrderPaymentStatus, string> = {
  UNPAID: "Sin pagar",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagado",
  PARTIALLY_REFUNDED: "Reembolso parcial",
  REFUNDED: "Reembolsado",
  CHARGED_BACK: "Contracargo",
};

export const ORDER_PAYMENT_STATUS_BADGE_VARIANT: Record<
  OrderPaymentStatus,
  "default" | "outline" | "secondary"
> = {
  UNPAID: "outline",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  PARTIALLY_REFUNDED: "secondary",
  REFUNDED: "secondary",
  CHARGED_BACK: "secondary",
};

export const DELIVERY_METHOD_LABELS_ES: Record<DeliveryMethod, string> = {
  PICKUP: "Retiro",
  HOME_DELIVERY: "Envío a domicilio",
};

// Phase — Mercado Pago Checkout Pro integration. Never expose "CREATED",
// "PENDING", etc. directly in the UI — every admin-facing payment surface
// reads from here.
export const PAYMENT_ATTEMPT_STATUS_LABELS_ES: Record<PaymentAttemptStatus, string> = {
  CREATED: "Preferencia creada",
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  FAILED_RECONCILIATION: "Requiere revisión",
  SUPERSEDED: "Reemplazado",
};

export const PAYMENT_ATTEMPT_STATUS_BADGE_VARIANT: Record<
  PaymentAttemptStatus,
  "default" | "outline" | "secondary" | "destructive"
> = {
  CREATED: "outline",
  PENDING: "outline",
  APPROVED: "default",
  REJECTED: "secondary",
  CANCELLED: "secondary",
  REFUNDED: "secondary",
  FAILED_RECONCILIATION: "destructive",
  SUPERSEDED: "secondary",
};
