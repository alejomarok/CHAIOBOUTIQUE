import type { PaymentAttemptStatus } from "@/generated/prisma/client";

// The subset of PaymentAttemptStatus this mapping can ever actually
// produce — deliberately narrower than the full enum (which also has
// CREATED/FAILED_RECONCILIATION/SUPERSEDED, none of which a raw provider
// status string ever maps directly to) so reconcile-core.ts's switch over
// this result stays exhaustively checked by the compiler.
export type MappedMercadoPagoStatus = Extract<
  PaymentAttemptStatus,
  "APPROVED" | "PENDING" | "REJECTED" | "CANCELLED" | "REFUNDED"
>;

// Deliberate mapping between Mercado Pago's raw payment.status string and
// this integration's own PaymentAttemptStatus — see this integration's
// "create a deliberate mapping" requirement. Only "approved" is ever
// eligible to trigger finalizePaidOrder; every other value is unambiguously
// non-approving. An unrecognized status is never silently treated as safe —
// it maps to null, which reconcile-core.ts treats as a distinct "unknown
// status" outcome (surfaced for admin review), never as an implicit
// PENDING/APPROVED guess.
export function mapMercadoPagoPaymentStatus(providerStatus: string): MappedMercadoPagoStatus | null {
  switch (providerStatus) {
    case "approved":
      return "APPROVED";
    case "pending":
    case "in_process":
    case "authorized":
      return "PENDING";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELLED";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    default:
      return null;
  }
}
