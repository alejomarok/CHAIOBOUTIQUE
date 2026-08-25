import type { InvoiceMode, PaymentMethod, SalePaymentStatus, SaleStatus } from "@/generated/prisma/client";
import { endOfDayExclusiveInTimezone, startOfDayInTimezone } from "@/lib/store-timezone";
import type { SaleInvoicingStatusFilter } from "@/modules/sales/report";
import type { SalesReportFilters } from "@/modules/sales/report";
import type { SaleOrigin } from "@/modules/sales/report";

// Pure — shared by the consultation page and its CSV export Server Actions,
// so the two can never validate the same query-string filters differently.
// Every value from `searchParams`/a Server Action's plain-object input is
// untrusted (this phase's explicit "validate all search params server-
// side; do not trust arbitrary enums or dates from query string"
// requirement) — every function here either returns a real typed value or
// `undefined`, never throws on garbage input (an invalid/tampered filter
// is simply ignored, not a hard error, matching the same posture the
// existing /admin/sales list page already uses for its own filters).

export interface SalesConsultationSearchParams {
  from?: string;
  to?: string;
  code?: string;
  customer?: string;
  product?: string;
  status?: string;
  paymentStatus?: string;
  invoicingStatus?: string;
  invoicingMode?: string;
  origin?: string;
  paymentMethod?: string;
  warehouseId?: string;
  sellerId?: string;
  page?: string;
}

function isValidDateString(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidStatus(value: string | undefined): value is SaleStatus {
  return value === "DRAFT" || value === "CONFIRMED" || value === "CANCELLED";
}

function isValidPaymentStatus(value: string | undefined): value is SalePaymentStatus {
  return value === "UNPAID" || value === "PARTIALLY_PAID" || value === "PAID";
}

function isValidInvoicingStatus(value: string | undefined): value is SaleInvoicingStatusFilter {
  return value === "NOT_INVOICED" || value === "PENDING" || value === "INVOICED" || value === "ERROR";
}

function isValidInvoicingMode(value: string | undefined): value is InvoiceMode {
  return value === "ELECTRONICA_ARCA" || value === "MANUAL" || value === "SISTEMA_EXTERNO";
}

function isValidOrigin(value: string | undefined): value is SaleOrigin {
  return value === "POS" || value === "ONLINE";
}

const VALID_PAYMENT_METHODS: readonly PaymentMethod[] = [
  "CASH",
  "BANK_TRANSFER",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "OTHER",
  "MERCADO_PAGO",
];
function isValidPaymentMethod(value: string | undefined): value is PaymentMethod {
  return VALID_PAYMENT_METHODS.includes(value as PaymentMethod);
}

// Resolves the raw, untrusted query-string shape into the real
// SalesReportFilters report-core.ts expects — dateFrom/dateToExclusive are
// resolved against the STORE's own timezone (never UTC, never the server
// process's local time) via lib/store-timezone.ts, exactly once, here.
export function parseSalesConsultationFilters(
  params: SalesConsultationSearchParams,
  timezone: string,
): SalesReportFilters {
  const fromDateString = isValidDateString(params.from) ? params.from : undefined;
  const toDateString = isValidDateString(params.to) ? params.to : undefined;

  return {
    dateFrom: fromDateString ? startOfDayInTimezone(fromDateString, timezone) : undefined,
    dateToExclusive: toDateString ? endOfDayExclusiveInTimezone(toDateString, timezone) : undefined,
    saleCodeSearch: params.code?.trim() || undefined,
    customerSearch: params.customer?.trim() || undefined,
    productSearch: params.product?.trim() || undefined,
    status: isValidStatus(params.status) ? params.status : undefined,
    paymentStatus: isValidPaymentStatus(params.paymentStatus) ? params.paymentStatus : undefined,
    invoicingStatus: isValidInvoicingStatus(params.invoicingStatus) ? params.invoicingStatus : undefined,
    invoicingMode: isValidInvoicingMode(params.invoicingMode) ? params.invoicingMode : undefined,
    origin: isValidOrigin(params.origin) ? params.origin : undefined,
    paymentMethod: isValidPaymentMethod(params.paymentMethod) ? params.paymentMethod : undefined,
    warehouseId: params.warehouseId || undefined,
    createdById: params.sellerId || undefined,
  };
}

export function parsePageNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
