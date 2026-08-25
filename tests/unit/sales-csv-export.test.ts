import { describe, expect, it } from "vitest";

import {
  buildCsv,
  buildSalesReportCsv,
  buildSalesReportDetailCsv,
} from "@/modules/sales/csv-export-core";

describe("buildCsv", () => {
  it("prefixes a UTF-8 BOM so Excel renders accented characters correctly", () => {
    const csv = buildCsv(["Cliente"], [["María José"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("quotes and escapes a field containing a comma, quote, or newline", () => {
    const csv = buildCsv(["Nota"], [['dijo "hola", chau'], ["línea\ncon salto"]]);
    expect(csv).toContain('"dijo ""hola"", chau"');
    expect(csv).toContain('"línea\ncon salto"');
  });

  it("leaves a plain field unquoted", () => {
    const csv = buildCsv(["Código"], [["VEN-00125"]]);
    expect(csv).toContain("VEN-00125");
    expect(csv).not.toContain('"VEN-00125"');
  });

  it("uses CRLF line endings", () => {
    const csv = buildCsv(["A"], [["1"], ["2"]]);
    expect(csv).toContain("\r\n");
  });
});

describe("buildSalesReportCsv", () => {
  it("produces the exact spec'd header row", () => {
    const csv = buildSalesReportCsv([]);
    expect(csv).toContain(
      "Venta,Fecha,Cliente,Documento,Origen,Estado venta,Estado pago,Facturación,Subtotal,Descuento,Total,Pagado,Saldo,Vendedor",
    );
  });

  it("formats BigInt amounts as comma-decimal strings, never floats", () => {
    const csv = buildSalesReportCsv([
      {
        code: "VEN-00125",
        saleDateDisplay: "19/08/2026 18:45",
        customerName: "Juan Pérez",
        customerDocument: "DNI 30111222",
        origin: "Venta online",
        statusLabel: "Confirmada",
        paymentStatusLabel: "Pagada",
        invoicingStatusLabel: "Facturada",
        subtotalAmount: 12000000n,
        discountTotalAmount: 0n,
        totalAmount: 12000000n,
        paidAmount: 12000000n,
        remainingAmount: 0n,
        sellerName: "Alejo",
      },
    ]);
    expect(csv).toContain("120000,00"); // 12,000,000 minor units = $120.000,00
    expect(csv).toContain("VEN-00125");
    expect(csv).toContain("Venta online");
  });

  it("never lets a customer name containing a comma break the column structure", () => {
    const csv = buildSalesReportCsv([
      {
        code: "VEN-1",
        saleDateDisplay: "19/08/2026",
        customerName: "Pérez, Juan",
        customerDocument: "",
        origin: "Venta en local",
        statusLabel: "Confirmada",
        paymentStatusLabel: "Pagada",
        invoicingStatusLabel: "Sin facturar",
        subtotalAmount: 1000n,
        discountTotalAmount: 0n,
        totalAmount: 1000n,
        paidAmount: 1000n,
        remainingAmount: 0n,
        sellerName: "Alejo",
      },
    ]);
    expect(csv).toContain('"Pérez, Juan"');
  });
});

describe("buildSalesReportDetailCsv", () => {
  it("is a genuinely separate export with its own line-item-shaped headers", () => {
    const csv = buildSalesReportDetailCsv([]);
    expect(csv).toContain("Venta,Fecha,Cliente,SKU,Producto,Color,Talle,Cantidad,Precio unitario,Descuento,Total línea");
  });

  it("formats one row per SaleItem line", () => {
    const csv = buildSalesReportDetailCsv([
      {
        code: "VEN-1",
        saleDateDisplay: "19/08/2026",
        customerName: "Juan Pérez",
        sku: "REM-AZUL-M",
        productName: "Remera",
        colorName: "Azul",
        sizeName: "M",
        quantity: 2,
        unitPriceAmount: 500000n,
        discountAmount: 0n,
        totalAmount: 1000000n,
      },
    ]);
    expect(csv).toContain("REM-AZUL-M");
    expect(csv).toContain("5000,00");
    expect(csv).toContain("10000,00");
  });
});
