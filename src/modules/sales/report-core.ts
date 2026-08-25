import type { InvoiceMode, PaymentMethod, Prisma, SalePaymentStatus, SaleStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";

import { invoicingModeWhere, invoicingStatusWhere } from "./invoicing-filters";
import type { SaleInvoicingStatusFilter } from "./invoicing-filters";

export type { SaleInvoicingStatusFilter } from "./invoicing-filters";

// Node-safe core: no "server-only" import — mirrors sale-core.ts's own
// -core convention. SCOPE — Sales Consultation & Commercial Reporting:
// read-only historical search/filter/summary over EXISTING Sale data. Never
// creates, edits, confirms, cancels, pays, or invoices anything — see this
// phase's explicit "no business logic changes" requirement. Deliberately a
// SEPARATE module from sale-core.ts (not more functions bolted onto it):
// this is a genuinely different concern (read-only consultation vs.
// commercial transaction management), the same separation-of-concerns
// precedent as modules/fiscal-documents being its own module that reuses
// modules/sales rather than living inside it.

// Non-persisted, purely derived from Sale.orderId's own existing nullability
// (see that field's schema comment: "Set only for a Sale created by
// finalizePaidOrder... always null for a POS-built Sale") — no new column,
// per this phase's explicit "do not add redundant persisted state if it can
// be derived safely" instruction.
export type SaleOrigin = "POS" | "ONLINE";

export function deriveSaleOrigin(sale: { orderId: string | null }): SaleOrigin {
  return sale.orderId ? "ONLINE" : "POS";
}

export interface SalesReportFilters {
  // Both already resolved to concrete UTC instants by the caller — see
  // lib/store-timezone.ts's startOfDayInTimezone/endOfDayExclusiveInTimezone.
  // This module never interprets a raw date string itself, so it can never
  // reintroduce the UTC-day-boundary bug the timezone module exists to
  // prevent.
  dateFrom?: Date;
  dateToExclusive?: Date;
  saleCodeSearch?: string;
  // Matches Sale.customerNameSnapshot OR Sale.customerDocumentSnapshot —
  // the historical snapshot, never a live Customer join (same posture as
  // sale-core.ts's own listSales search, and this phase's explicit
  // "historical Sale customer snapshot is the display authority" rule).
  customerSearch?: string;
  status?: SaleStatus;
  paymentStatus?: SalePaymentStatus;
  invoicingStatus?: SaleInvoicingStatusFilter;
  invoicingMode?: InvoiceMode;
  origin?: SaleOrigin;
  // Active payments only — see this phase's explicit "use active payment
  // records only" rule. A split-payment Sale can match more than one
  // method filter across separate queries, by design.
  paymentMethod?: PaymentMethod;
  warehouseId?: string;
  createdById?: string;
  // Matches ProductVariant.sku OR the owning Product.name — resolved to a
  // set of variant ids first (see resolveMatchingVariantIds), then applied
  // as a relational `items.some` filter, which returns each matching Sale
  // exactly ONCE regardless of how many matching lines it has (an EXISTS
  // subquery, never a row-multiplying JOIN) — see this phase's explicit
  // "do not duplicate the Sale row once for every matching item"
  // requirement.
  productSearch?: string;
}

export interface ListSalesReportInput extends SalesReportFilters {
  take?: number;
  skip?: number;
}

const MAX_MATCHING_VARIANTS = 1000;

async function resolveMatchingVariantIds(productSearch: string): Promise<string[]> {
  const term = productSearch.trim();
  if (!term) return [];
  const variants = await prisma.productVariant.findMany({
    where: {
      OR: [
        { sku: { contains: term, mode: "insensitive" } },
        { product: { name: { contains: term, mode: "insensitive" } } },
      ],
    },
    select: { id: true },
    take: MAX_MATCHING_VARIANTS,
  });
  return variants.map((v) => v.id);
}

// Shared by both listSalesForReport and getSalesReportSummary so the two
// can never silently drift on what "matches the current filter" means —
// the summary must always describe exactly the rows the list shows.
function buildWhere(filters: SalesReportFilters, matchingVariantIds: string[] | null): Prisma.SaleWhereInput {
  const saleCodeTerm = filters.saleCodeSearch?.trim();
  const customerTerm = filters.customerSearch?.trim();

  return {
    ...(filters.dateFrom || filters.dateToExclusive
      ? {
          saleDate: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateToExclusive ? { lt: filters.dateToExclusive } : {}),
          },
        }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
    ...(filters.invoicingStatus ? invoicingStatusWhere(filters.invoicingStatus) : {}),
    ...(filters.invoicingMode ? invoicingModeWhere(filters.invoicingMode) : {}),
    ...(filters.origin === "POS" ? { orderId: null } : {}),
    ...(filters.origin === "ONLINE" ? { orderId: { not: null } } : {}),
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    ...(filters.createdById ? { createdById: filters.createdById } : {}),
    ...(filters.paymentMethod
      ? { payments: { some: { method: filters.paymentMethod, status: "ACTIVE" } } }
      : {}),
    ...(matchingVariantIds ? { items: { some: { productVariantId: { in: matchingVariantIds } } } } : {}),
    ...(saleCodeTerm ? { code: { contains: saleCodeTerm, mode: "insensitive" } } : {}),
    ...(customerTerm
      ? {
          OR: [
            { customerNameSnapshot: { contains: customerTerm, mode: "insensitive" } },
            { customerDocumentSnapshot: { contains: customerTerm, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

// Explicit select — never a bare include — matching this codebase's
// established public/reporting-boundary convention (see modules/products/
// public-queries.ts). Never returns referenceCostAmount or anything from
// Customer/User beyond id+name; no raw fiscal/payment child rows either
// (those are separate, purpose-built reads — see getInvoicingStatusForSales
// and the Sale detail page's own getSaleById — never N+1'd in here).
const SALE_REPORT_ROW_SELECT = {
  id: true,
  code: true,
  saleDate: true,
  status: true,
  paymentStatus: true,
  customerNameSnapshot: true,
  customerDocumentSnapshot: true,
  subtotalAmount: true,
  discountTotalAmount: true,
  totalAmount: true,
  paidAmount: true,
  orderId: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.SaleSelect;

export type SalesReportRow = Prisma.SaleGetPayload<{ select: typeof SALE_REPORT_ROW_SELECT }>;

// Server-side filtered + paginated — never loads the full history. Two
// queries total (rows + count) regardless of result size or filter
// combination; the one extra query for productSearch (resolving matching
// variant ids) only runs when that filter is actually used.
export async function listSalesForReport(
  input: ListSalesReportInput = {},
): Promise<{ sales: SalesReportRow[]; total: number }> {
  const take = Math.min(input.take ?? 25, 100);
  const skip = Math.max(input.skip ?? 0, 0);

  const matchingVariantIds = input.productSearch ? await resolveMatchingVariantIds(input.productSearch) : null;
  if (input.productSearch && matchingVariantIds && matchingVariantIds.length === 0) {
    return { sales: [], total: 0 };
  }

  const where = buildWhere(input, matchingVariantIds);

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({ where, orderBy: { saleDate: "desc" }, take, skip, select: SALE_REPORT_ROW_SELECT }),
    prisma.sale.count({ where }),
  ]);

  return { sales, total };
}

export interface SalesReportSummary {
  // Confirmed/non-cancelled Sales matching the current filter — see this
  // phase's explicit exclusion rule below.
  saleCount: number;
  totalSoldAmount: bigint;
  totalCollectedAmount: bigint;
  // sum(max(totalAmount - paidAmount, 0)) per this phase's own spec.
  // Computed here as max(totalSoldAmount - totalCollectedAmount, 0) at the
  // AGGREGATE level, which is mathematically identical to the per-row
  // formula ONLY because registerSalePayment already guarantees
  // paidAmount <= totalAmount for every individual Sale (overpayment is
  // blocked server-side — see modules/sales/payment-core.ts) — i.e. every
  // row's own (total - paid) is already >= 0, so summing first and
  // clamping once produces the exact same result as clamping every row
  // first. This is NOT a shortcut that changes the number; it's a
  // consequence of an invariant enforced elsewhere in this codebase,
  // documented here so it's never silently relied on without a reader
  // understanding why it's safe.
  totalPendingAmount: bigint;
  // null when saleCount is 0 (never a divide-by-zero, never a fake $0).
  averageTicketAmount: bigint | null;
  // Shown SEPARATELY, per this phase's explicit "do not blend it with
  // completed sales" rule — never added into totalSoldAmount above.
  cancelledCount: number;
  cancelledAmount: bigint;
}

export async function getSalesReportSummary(filters: SalesReportFilters = {}): Promise<SalesReportSummary> {
  const matchingVariantIds = filters.productSearch ? await resolveMatchingVariantIds(filters.productSearch) : null;
  if (filters.productSearch && matchingVariantIds && matchingVariantIds.length === 0) {
    return {
      saleCount: 0,
      totalSoldAmount: 0n,
      totalCollectedAmount: 0n,
      totalPendingAmount: 0n,
      averageTicketAmount: null,
      cancelledCount: 0,
      cancelledAmount: 0n,
    };
  }

  const baseWhere = buildWhere(filters, matchingVariantIds);
  // Overrides any status filter the caller already applied — see this
  // function's own header: the summary always describes "of the rows
  // matching the current filter, how much is real (non-cancelled) revenue
  // vs. how much is attributable to cancelled Sales", which stays correct
  // and non-misleading even in the edge case where the admin's own filter
  // is status=CANCELLED (real revenue then correctly reads as zero).
  const nonCancelledWhere: Prisma.SaleWhereInput = { ...baseWhere, status: { not: "CANCELLED" } };
  const cancelledWhere: Prisma.SaleWhereInput = { ...baseWhere, status: "CANCELLED" };

  const [nonCancelledAgg, cancelledAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: nonCancelledWhere,
      _count: true,
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.sale.aggregate({ where: cancelledWhere, _count: true, _sum: { totalAmount: true } }),
  ]);

  const saleCount = nonCancelledAgg._count;
  const totalSoldAmount = nonCancelledAgg._sum.totalAmount ?? 0n;
  const totalCollectedAmount = nonCancelledAgg._sum.paidAmount ?? 0n;
  const rawPending = totalSoldAmount - totalCollectedAmount;
  const totalPendingAmount = rawPending > 0n ? rawPending : 0n;

  return {
    saleCount,
    totalSoldAmount,
    totalCollectedAmount,
    totalPendingAmount,
    averageTicketAmount: saleCount > 0 ? totalSoldAmount / BigInt(saleCount) : null,
    cancelledCount: cancelledAgg._count,
    cancelledAmount: cancelledAgg._sum.totalAmount ?? 0n,
  };
}

export interface SaleItemDetailRow {
  saleId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPriceAmount: bigint;
  discountAmount: bigint;
  totalAmount: bigint;
  colorName: string | null;
  sizeName: string | null;
}

// Every SaleItem across a set of Sales, with the customer-friendly color/
// size names an export or an admin-detail view needs — never internal
// IDs (see this phase's explicit "show customer-friendly product
// descriptions, not internal IDs" requirement). One query regardless of
// how many Sales are passed, never N+1 per Sale.
export async function listSaleItemDetailRows(saleIds: string[]): Promise<SaleItemDetailRow[]> {
  if (saleIds.length === 0) return [];
  const items = await prisma.saleItem.findMany({
    where: { saleId: { in: saleIds } },
    select: {
      saleId: true,
      productNameSnapshot: true,
      skuSnapshot: true,
      quantity: true,
      unitPriceAmount: true,
      discountAmount: true,
      totalAmount: true,
      productVariant: {
        select: { color: { select: { displayName: true } }, sizeOption: { select: { label: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return items.map((item) => ({
    saleId: item.saleId,
    productNameSnapshot: item.productNameSnapshot,
    skuSnapshot: item.skuSnapshot,
    quantity: item.quantity,
    unitPriceAmount: item.unitPriceAmount,
    discountAmount: item.discountAmount,
    totalAmount: item.totalAmount,
    colorName: item.productVariant.color?.displayName ?? null,
    sizeName: item.productVariant.sizeOption?.label ?? null,
  }));
}

export interface SaleSellerOption {
  id: string;
  name: string;
}

// Distinct list of staff who have ever created a Sale — for the "Vendedor"
// filter dropdown. One query, computed once per page render, never per
// row. Small by construction (bounded by staff headcount, not Sale count).
export async function listSaleSellers(): Promise<SaleSellerOption[]> {
  const rows = await prisma.sale.findMany({
    distinct: ["createdById"],
    select: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdById: "asc" },
  });
  return rows.map((row) => row.createdBy).sort((a, b) => a.name.localeCompare(b.name, "es-AR"));
}
