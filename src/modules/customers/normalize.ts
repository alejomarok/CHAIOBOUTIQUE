// Pure, no "server-only", no DB import — unit-testable in isolation and
// safe to reuse from both the Node-safe core service layer and (if ever
// needed) client-side live-validation feedback.

// Digits-only projection used for exact strong-identifier duplicate
// detection (Customer.documentNumberNormalized/taxIdNormalized — see
// schema.prisma's Customer model). Deliberately strips ALL non-digit
// characters (dots, dashes, spaces) rather than validating a specific
// country's format: "30.123.456", "30123456" and "30 123 456" must all
// normalize identically, and this schema is not Argentina-only (see this
// phase's own instructions).
export function normalizeStrongIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digitsOnly = raw.replace(/\D/g, "");
  return digitsOnly.length > 0 ? digitsOnly : null;
}

// Emails are stored already-normalized (trim + lowercase) — unlike
// documentNumber, there's no display-fidelity reason to keep the original
// casing, so no separate *Normalized column exists for this on Customer.
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

// Stored as the canonical form of Customer.phone itself (not a separate
// *Normalized column — see schema.prisma's comment on that field): strips
// everything except digits and a single leading "+". A normalized phone
// number is still perfectly usable/dialable, unlike a formatted document
// number a staff member may deliberately want preserved as entered.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hasLeadingPlus = raw.trim().startsWith("+");
  const digitsOnly = raw.replace(/\D/g, "");
  if (digitsOnly.length === 0) return null;
  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

export interface CustomerNameFields {
  type: "PERSON" | "COMPANY";
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
}

// The single "how do we show this customer" rule — never persisted (a
// derived value would just be a second, driftable copy of firstName/
// lastName/businessName). Every UI surface (list, detail, duplicate-warning
// dialog) calls this instead of re-deriving its own version.
export function getCustomerDisplayName(customer: CustomerNameFields): string {
  if (customer.type === "COMPANY") {
    return customer.businessName?.trim() || "Empresa sin nombre";
  }
  const parts = [customer.firstName?.trim(), customer.lastName?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Cliente sin nombre";
}
