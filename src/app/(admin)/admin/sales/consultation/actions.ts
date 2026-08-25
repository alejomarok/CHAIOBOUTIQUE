"use server";

import { requirePermission } from "@/modules/auth";
import { getInvoicingStatusForSales } from "@/modules/fiscal-documents/fiscal-document";
import { SALE_INVOICING_STATUS_LABELS_ES } from "@/modules/fiscal-documents/labels";
import { buildSalesReportCsv, buildSalesReportDetailCsv } from "@/modules/sales/csv-export-core";
import { PAYMENT_STATUS_LABELS_ES } from "@/modules/sales/payment-labels";
import { deriveSaleOrigin, listSalesForReport, listSaleItemDetailRows } from "@/modules/sales/report";
import { getStoreConfiguration } from "@/modules/store-settings/service";

import { parseSalesConsultationFilters, type SalesConsultationSearchParams } from "./search-params";

// A read-only reporting export — never creates an audit record just for a
// view/export (this phase's explicit "do not create audit records merely
// because someone viewed a report" rule), and never touches commercial data.

const STATUS_LABELS_ES = { DRAFT: "Borrador", CONFIRMED: "Confirmada", CANCELLED: "Cancelada" } as const;
const ORIGIN_LABELS_ES = { POS: "Venta en local", ONLINE: "Venta online" } as const;

// Bounded — an export is still a reporting action, never an unbounded full-
// history dump. Matches this phase's "export the FILTERED result, not the
// entire DB accidentally" requirement together with the filters themselves;
// this cap is the last line of defense if a filter set is broad.
const EXPORT_ROW_LIMIT = 5000;

export async function exportSalesReportCsvAction(
  params: SalesConsultationSearchParams,
): Promise<{ filename: string; csv: string }> {
  await requirePermission("sales.view");
  const { timezone } = await getStoreConfiguration();
  const filters = parseSalesConsultationFilters(params, timezone);

  const { sales } = await listSalesForReport({ ...filters, take: EXPORT_ROW_LIMIT, skip: 0 });
  const invoicingStatusBySale = await getInvoicingStatusForSales(sales.map((s) => s.id));

  const csv = buildSalesReportCsv(
    sales.map((sale) => ({
      code: sale.code,
      saleDateDisplay: new Date(sale.saleDate).toLocaleString("es-AR"),
      customerName: sale.customerNameSnapshot,
      customerDocument: sale.customerDocumentSnapshot ?? "",
      origin: ORIGIN_LABELS_ES[deriveSaleOrigin(sale)],
      statusLabel: STATUS_LABELS_ES[sale.status],
      paymentStatusLabel: PAYMENT_STATUS_LABELS_ES[sale.paymentStatus],
      invoicingStatusLabel: SALE_INVOICING_STATUS_LABELS_ES[invoicingStatusBySale.get(sale.id) ?? "NOT_INVOICED"],
      subtotalAmount: sale.subtotalAmount,
      discountTotalAmount: sale.discountTotalAmount,
      totalAmount: sale.totalAmount,
      paidAmount: sale.paidAmount,
      remainingAmount: sale.totalAmount - sale.paidAmount > 0n ? sale.totalAmount - sale.paidAmount : 0n,
      sellerName: sale.createdBy.name,
    })),
  );

  return { filename: `ventas_${new Date().toISOString().slice(0, 10)}.csv`, csv };
}

export async function exportSalesReportDetailCsvAction(
  params: SalesConsultationSearchParams,
): Promise<{ filename: string; csv: string }> {
  await requirePermission("sales.view");
  const { timezone } = await getStoreConfiguration();
  const filters = parseSalesConsultationFilters(params, timezone);

  const { sales } = await listSalesForReport({ ...filters, take: EXPORT_ROW_LIMIT, skip: 0 });
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const items = await listSaleItemDetailRows(sales.map((s) => s.id));

  const csv = buildSalesReportDetailCsv(
    items.map((item) => {
      const sale = saleById.get(item.saleId)!;
      return {
        code: sale.code,
        saleDateDisplay: new Date(sale.saleDate).toLocaleString("es-AR"),
        customerName: sale.customerNameSnapshot,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        colorName: item.colorName ?? "",
        sizeName: item.sizeName ?? "",
        quantity: item.quantity,
        unitPriceAmount: item.unitPriceAmount,
        discountAmount: item.discountAmount,
        totalAmount: item.totalAmount,
      };
    }),
  );

  return { filename: `ventas_detalle_${new Date().toISOString().slice(0, 10)}.csv`, csv };
}
