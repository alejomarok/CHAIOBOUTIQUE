// Pure — no "server-only", no DB import. Hand-written CSV serialization:
// no writer library exists in this repo (only csv-parse, a READER — see
// this phase's own architecture audit), and the format needed (UTF-8,
// Excel-compatible, comma-separated, quoted-when-needed) is simple enough
// not to justify adding a new dependency for it.
import { minorUnitsToDecimalString } from "@/lib/money";

// Excel (on Windows especially) mis-detects a plain UTF-8 CSV as the
// system's legacy codepage unless a BOM is present — this is the standard,
// minimal fix, not a workaround for a bug in this code.
const UTF8_BOM = "﻿";

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

// Decimal string ("1500.50"), never Number/toFixed — see lib/money.ts's own
// "no float authority for money" convention. Uses a comma decimal separator
// (es-AR/Excel-es convention) since this is a customer-facing export, not
// an API payload.
function amountToCsvNumber(amountMinorUnits: bigint): string {
  return minorUnitsToDecimalString(amountMinorUnits).replace(".", ",");
}

export interface SalesReportCsvRow {
  code: string;
  saleDateDisplay: string;
  customerName: string;
  customerDocument: string;
  origin: string;
  statusLabel: string;
  paymentStatusLabel: string;
  invoicingStatusLabel: string;
  subtotalAmount: bigint;
  discountTotalAmount: bigint;
  totalAmount: bigint;
  paidAmount: bigint;
  remainingAmount: bigint;
  sellerName: string;
}

const SALES_REPORT_CSV_HEADERS = [
  "Venta",
  "Fecha",
  "Cliente",
  "Documento",
  "Origen",
  "Estado venta",
  "Estado pago",
  "Facturación",
  "Subtotal",
  "Descuento",
  "Total",
  "Pagado",
  "Saldo",
  "Vendedor",
];

export function buildSalesReportCsv(rows: SalesReportCsvRow[]): string {
  return buildCsv(
    SALES_REPORT_CSV_HEADERS,
    rows.map((row) => [
      row.code,
      row.saleDateDisplay,
      row.customerName,
      row.customerDocument,
      row.origin,
      row.statusLabel,
      row.paymentStatusLabel,
      row.invoicingStatusLabel,
      amountToCsvNumber(row.subtotalAmount),
      amountToCsvNumber(row.discountTotalAmount),
      amountToCsvNumber(row.totalAmount),
      amountToCsvNumber(row.paidAmount),
      amountToCsvNumber(row.remainingAmount),
      row.sellerName,
    ]),
  );
}

export interface SalesReportDetailCsvRow {
  code: string;
  saleDateDisplay: string;
  customerName: string;
  sku: string;
  productName: string;
  colorName: string;
  sizeName: string;
  quantity: number;
  unitPriceAmount: bigint;
  discountAmount: bigint;
  totalAmount: bigint;
}

const SALES_REPORT_DETAIL_CSV_HEADERS = [
  "Venta",
  "Fecha",
  "Cliente",
  "SKU",
  "Producto",
  "Color",
  "Talle",
  "Cantidad",
  "Precio unitario",
  "Descuento",
  "Total línea",
];

// Deliberately a SEPARATE export from buildSalesReportCsv — never flattens
// every SaleItem into the main sales export automatically (see this
// phase's explicit "if detailed export is implemented, provide it
// separately" instruction).
export function buildSalesReportDetailCsv(rows: SalesReportDetailCsvRow[]): string {
  return buildCsv(
    SALES_REPORT_DETAIL_CSV_HEADERS,
    rows.map((row) => [
      row.code,
      row.saleDateDisplay,
      row.customerName,
      row.sku,
      row.productName,
      row.colorName,
      row.sizeName,
      String(row.quantity),
      amountToCsvNumber(row.unitPriceAmount),
      amountToCsvNumber(row.discountAmount),
      amountToCsvNumber(row.totalAmount),
    ]),
  );
}
