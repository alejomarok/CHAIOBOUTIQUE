// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { endOfDayExclusiveInTimezone, startOfDayInTimezone } from "@/lib/store-timezone";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import { registerExternalFiscalDocument, registerManualFiscalDocument } from "@/modules/fiscal-documents/fiscal-document";
import { adjustInventory } from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import { deriveSaleOrigin, getSalesReportSummary, listSalesForReport, listSaleSellers } from "@/modules/sales/report";
import { registerSalePayment, voidSalePayment } from "@/modules/sales/payment";
import { cancelSale, createSale } from "@/modules/sales/sale";
import { getStoreConfiguration } from "@/modules/store-settings/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

describe("Sales Consultation & Commercial Reporting — report-core.ts (real DB)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function makeActor(namePrefix = "Report Actor") {
    const actor = await createTestUser({
      name: namePrefix,
      email: `report-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  async function makeSellableVariant(actorId: string, priceAmount: bigint, skuHint = "RPT") {
    const category = await createCategory({ name: `Report Cat ${Date.now()}-${Math.random()}` }, actorId);
    const product = await createProduct(
      { name: `Report Producto ${skuHint} ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `${skuHint}-${Date.now()}-${Math.random()}`, priceAmount }],
      actorId,
    );
    return { product, variant };
  }

  async function getDefaultWarehouseId() {
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    return warehouse.id;
  }

  async function makePersonCustomer(actorId: string, overrides: { firstName?: string; documentNumber?: string } = {}) {
    const result = await createCustomer(
      {
        type: "PERSON",
        firstName: overrides.firstName ?? "Cliente",
        lastName: `Reporte ${Date.now()}-${Math.random()}`,
        documentType: "DNI",
        documentNumber: overrides.documentNumber ?? `${Math.floor(10000000 + Math.random() * 89999999)}`,
      },
      actorId,
    );
    if (result.status !== "created") throw new Error("unreachable");
    return result.customer;
  }

  async function makeConfirmedSale(
    actorId: string,
    opts: { totalAmount?: bigint; quantity?: number; customerId?: string; skuHint?: string } = {},
  ) {
    const totalAmount = opts.totalAmount ?? 100000n;
    const quantity = opts.quantity ?? 1;
    const unitPrice = totalAmount / BigInt(quantity);
    const customer = opts.customerId ? { id: opts.customerId } : await makePersonCustomer(actorId);
    const { variant } = await makeSellableVariant(actorId, unitPrice, opts.skuHint);
    const warehouseId = await getDefaultWarehouseId();
    await adjustInventory({
      variantId: variant.id,
      warehouseId,
      quantityDelta: quantity + 5,
      movementType: "INITIAL_STOCK",
      actorId,
    });
    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity }], confirm: true },
      actorId,
    );
    return { sale, variant, customer, warehouseId };
  }

  // ===========================================================================
  // Origin
  // ===========================================================================
  it("deriveSaleOrigin: POS for a Sale with no linked Order, ONLINE for one with an orderId", () => {
    expect(deriveSaleOrigin({ orderId: null })).toBe("POS");
    expect(deriveSaleOrigin({ orderId: "some-order-id" })).toBe("ONLINE");
  });

  // ===========================================================================
  // Basic search / pagination / no-duplicate-rows
  // ===========================================================================
  it("listSalesForReport: filters by Sale code (case-insensitive, partial match)", async () => {
    const actor = await makeActor();
    const { sale } = await makeConfirmedSale(actor.id, { totalAmount: 50000n });

    const { sales, total } = await listSalesForReport({ saleCodeSearch: sale.code.toLowerCase() });
    expect(total).toBe(1);
    expect(sales[0].id).toBe(sale.id);
  });

  it("listSalesForReport: filters by customer name and by customer document snapshot", async () => {
    const actor = await makeActor();
    const uniqueFirstName = `Zooey${Date.now()}`;
    const customer = await makePersonCustomer(actor.id, { firstName: uniqueFirstName, documentNumber: "30111222" });
    const { sale } = await makeConfirmedSale(actor.id, { customerId: customer.id });

    const byName = await listSalesForReport({ customerSearch: uniqueFirstName });
    expect(byName.sales.map((s) => s.id)).toContain(sale.id);

    const byDocument = await listSalesForReport({ customerSearch: "30111222" });
    expect(byDocument.sales.map((s) => s.id)).toContain(sale.id);
  });

  it("listSalesForReport: pagination — take/skip never loads the whole history", async () => {
    const actor = await makeActor();
    const prefix = `PAG${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await makeConfirmedSale(actor.id, { totalAmount: 10000n, skuHint: prefix });
    }
    const page1 = await listSalesForReport({ productSearch: prefix, take: 2, skip: 0 });
    const page2 = await listSalesForReport({ productSearch: prefix, take: 2, skip: 2 });
    expect(page1.sales).toHaveLength(2);
    expect(page2.sales).toHaveLength(2);
    expect(page1.total).toBe(5);
    const ids1 = page1.sales.map((s) => s.id);
    const ids2 = page2.sales.map((s) => s.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  // ===========================================================================
  // Product / SKU search — no duplicate Sale rows for multi-item matches
  // ===========================================================================
  it("listSalesForReport: product/SKU search returns a Sale exactly ONCE even with multiple matching lines", async () => {
    const actor = await makeActor();
    const skuHint = `DUPCHK${Date.now()}`;
    const customer = await makePersonCustomer(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    const { variant: variantA } = await makeSellableVariant(actor.id, 10000n, skuHint);
    const { variant: variantB } = await makeSellableVariant(actor.id, 20000n, skuHint);
    await adjustInventory({ variantId: variantA.id, warehouseId, quantityDelta: 5, movementType: "INITIAL_STOCK", actorId: actor.id });
    await adjustInventory({ variantId: variantB.id, warehouseId, quantityDelta: 5, movementType: "INITIAL_STOCK", actorId: actor.id });

    // ONE Sale with TWO lines, both matching the same SKU-hint search term.
    const sale = await createSale(
      {
        customerId: customer.id,
        items: [
          { productVariantId: variantA.id, quantity: 1 },
          { productVariantId: variantB.id, quantity: 1 },
        ],
        confirm: true,
      },
      actor.id,
    );

    const { sales, total } = await listSalesForReport({ productSearch: skuHint });
    expect(total).toBe(1);
    expect(sales).toHaveLength(1);
    expect(sales[0].id).toBe(sale.id);
  });

  it("listSalesForReport: a product search matching nothing returns an empty result, not an error", async () => {
    const result = await listSalesForReport({ productSearch: `NOTHING-MATCHES-${Date.now()}` });
    expect(result).toEqual({ sales: [], total: 0 });
  });

  // ===========================================================================
  // Date range / timezone boundary — the exact bug this phase warns against
  // ===========================================================================
  it("listSalesForReport: a date-range filter includes a Sale made late at night in the store's own timezone", async () => {
    const actor = await makeActor();
    // A unique SKU-hint scope, exactly like this file's other tests — the
    // full `npm run test:integration` run shares ONE database across every
    // test FILE (globalSetup resets it once, not per file/test), so an
    // unscoped date-only filter can be diluted by unrelated same-day Sales
    // created by entirely different test files earlier in the same run.
    const skuHint = `TZBOUNDARY${Date.now()}`;
    const { sale } = await makeConfirmedSale(actor.id, { totalAmount: 15000n, skuHint });
    // Force saleDate to 23:30 local (Argentina, UTC-3) on a fixed day —
    // 2026-08-19T23:30:00 ART == 2026-08-20T02:30:00Z.
    const lateInstant = new Date("2026-08-20T02:30:00.000Z");
    await prisma.sale.update({ where: { id: sale.id }, data: { saleDate: lateInstant } });

    const tz = "America/Argentina/Cordoba";
    const dateFrom = startOfDayInTimezone("2026-08-19", tz);
    const dateToExclusive = endOfDayExclusiveInTimezone("2026-08-19", tz);

    const { sales } = await listSalesForReport({ dateFrom, dateToExclusive, productSearch: skuHint });
    expect(sales.map((s) => s.id)).toContain(sale.id);

    // A naive UTC-day filter would have wrongly excluded it — proving the
    // fix is actually load-bearing here, not just unit-tested in isolation.
    const naiveUtcFrom = new Date("2026-08-19T00:00:00.000Z");
    const naiveUtcTo = new Date("2026-08-20T00:00:00.000Z");
    const { sales: naiveResult } = await listSalesForReport({
      dateFrom: naiveUtcFrom,
      dateToExclusive: naiveUtcTo,
      productSearch: skuHint,
    });
    expect(naiveResult.map((s) => s.id)).not.toContain(sale.id);
  });

  // ===========================================================================
  // Status / payment status / payment method / warehouse / seller filters
  // ===========================================================================
  it("listSalesForReport: filters by Sale status, payment status, warehouse, and seller (createdBy)", async () => {
    const actorA = await makeActor("Vendedor A");
    const actorB = await makeActor("Vendedor B");
    const { sale: saleA, warehouseId } = await makeConfirmedSale(actorA.id, { totalAmount: 40000n });
    const { sale: saleB } = await makeConfirmedSale(actorB.id, { totalAmount: 40000n });

    const bySeller = await listSalesForReport({ createdById: actorA.id });
    expect(bySeller.sales.map((s) => s.id)).toContain(saleA.id);
    expect(bySeller.sales.map((s) => s.id)).not.toContain(saleB.id);

    const byWarehouse = await listSalesForReport({ warehouseId });
    expect(byWarehouse.sales.map((s) => s.id)).toContain(saleA.id);

    const byStatus = await listSalesForReport({ status: "CONFIRMED" });
    expect(byStatus.sales.map((s) => s.id)).toContain(saleA.id);

    const byPaymentStatus = await listSalesForReport({ paymentStatus: "UNPAID" });
    expect(byPaymentStatus.sales.map((s) => s.id)).toContain(saleA.id);
  });

  it("listSalesForReport: payment method filter matches only ACTIVE payments, and a split-payment Sale matches both methods", async () => {
    const actor = await makeActor();
    const { sale } = await makeConfirmedSale(actor.id, { totalAmount: 30000n });

    await registerSalePayment(
      { saleId: sale.id, method: "CASH", amount: 10000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );
    const transferPayment = await registerSalePayment(
      { saleId: sale.id, method: "BANK_TRANSFER", amount: 20000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );

    const byCash = await listSalesForReport({ paymentMethod: "CASH" });
    expect(byCash.sales.map((s) => s.id)).toContain(sale.id);
    const byTransfer = await listSalesForReport({ paymentMethod: "BANK_TRANSFER" });
    expect(byTransfer.sales.map((s) => s.id)).toContain(sale.id);

    // Void the transfer — the Sale must no longer match that method filter
    // (active payments only).
    await voidSalePayment(transferPayment.id, "prueba de reporte", actor.id);
    const byTransferAfterVoid = await listSalesForReport({ paymentMethod: "BANK_TRANSFER" });
    expect(byTransferAfterVoid.sales.map((s) => s.id)).not.toContain(sale.id);
    // Cash payment is untouched — still matches.
    const byCashAfterVoid = await listSalesForReport({ paymentMethod: "CASH" });
    expect(byCashAfterVoid.sales.map((s) => s.id)).toContain(sale.id);
  });

  // ===========================================================================
  // Invoicing status / mode filters — reused, not reimplemented
  // ===========================================================================
  it("listSalesForReport: invoicing status and mode filters reuse the real fiscal state", async () => {
    const actor = await makeActor();
    const { sale: manualSale } = await makeConfirmedSale(actor.id, { totalAmount: 25000n });
    await registerManualFiscalDocument(
      {
        saleId: manualSale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: `RPT-${Date.now()}`,
        issueDate: new Date(),
        totalAmount: 25000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    const { sale: externalSale } = await makeConfirmedSale(actor.id, { totalAmount: 35000n });
    await registerExternalFiscalDocument(
      {
        saleId: externalSale.id,
        documentType: "Factura C",
        documentNumber: `EXT-${Date.now()}`,
        issueDate: new Date(),
        totalAmount: 35000n,
        sourceSystem: "Sistema anterior",
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    const invoiced = await listSalesForReport({ invoicingStatus: "INVOICED" });
    expect(invoiced.sales.map((s) => s.id)).toContain(manualSale.id);
    expect(invoiced.sales.map((s) => s.id)).toContain(externalSale.id);

    const manualMode = await listSalesForReport({ invoicingMode: "MANUAL" });
    expect(manualMode.sales.map((s) => s.id)).toContain(manualSale.id);
    expect(manualMode.sales.map((s) => s.id)).not.toContain(externalSale.id);

    const externalMode = await listSalesForReport({ invoicingMode: "SISTEMA_EXTERNO" });
    expect(externalMode.sales.map((s) => s.id)).toContain(externalSale.id);
    expect(externalMode.sales.map((s) => s.id)).not.toContain(manualSale.id);
  });

  // ===========================================================================
  // Summary — BigInt arithmetic, cancelled exclusion, split payments, average
  // ===========================================================================
  it("getSalesReportSummary: excludes CANCELLED Sales from saleCount/totalSoldAmount, reports them separately", async () => {
    const actor = await makeActor();
    const prefix = `SUM${Date.now()}`;
    const { sale: activeSale } = await makeConfirmedSale(actor.id, { totalAmount: 100000n, skuHint: prefix });
    const { sale: cancelledSale } = await makeConfirmedSale(actor.id, { totalAmount: 50000n, skuHint: prefix });
    await cancelSale(cancelledSale.id, "cliente se arrepintió", actor.id);

    const summary = await getSalesReportSummary({ productSearch: prefix });
    expect(summary.saleCount).toBe(1);
    expect(summary.totalSoldAmount).toBe(100000n);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.cancelledAmount).toBe(50000n);
    // Never blended into the real total.
    expect(summary.totalSoldAmount).not.toBe(150000n);

    void activeSale;
  });

  it("getSalesReportSummary: totalCollectedAmount sums only ACTIVE payments (split payment, one voided)", async () => {
    const actor = await makeActor();
    const prefix = `SPLIT${Date.now()}`;
    const { sale } = await makeConfirmedSale(actor.id, { totalAmount: 100000n, skuHint: prefix });

    await registerSalePayment(
      { saleId: sale.id, method: "CASH", amount: 40000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );
    const voidedPayment = await registerSalePayment(
      { saleId: sale.id, method: "BANK_TRANSFER", amount: 30000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );
    await voidSalePayment(voidedPayment.id, "referencia incorrecta", actor.id);

    const summary = await getSalesReportSummary({ productSearch: prefix });
    // Only the CASH payment remains active (40.000) — the voided transfer
    // (30.000) must not count.
    expect(summary.totalCollectedAmount).toBe(40000n);
    expect(summary.totalPendingAmount).toBe(60000n); // 100.000 - 40.000
  });

  it("getSalesReportSummary: averageTicketAmount is totalSoldAmount / saleCount, and null when there are zero sales", async () => {
    const actor = await makeActor();
    const prefix = `AVG${Date.now()}`;
    await makeConfirmedSale(actor.id, { totalAmount: 100000n, skuHint: prefix });
    await makeConfirmedSale(actor.id, { totalAmount: 200000n, skuHint: prefix });

    const summary = await getSalesReportSummary({ productSearch: prefix });
    expect(summary.saleCount).toBe(2);
    expect(summary.totalSoldAmount).toBe(300000n);
    expect(summary.averageTicketAmount).toBe(150000n);

    const empty = await getSalesReportSummary({ productSearch: `NO-MATCH-${Date.now()}` });
    expect(empty.averageTicketAmount).toBeNull();
    expect(empty.saleCount).toBe(0);
  });

  // ===========================================================================
  // Sellers list (filter dropdown source)
  // ===========================================================================
  it("listSaleSellers: returns distinct sellers who have created at least one Sale", async () => {
    const actor = await makeActor("Vendedor Único");
    await makeConfirmedSale(actor.id, { totalAmount: 10000n });

    const sellers = await listSaleSellers();
    expect(sellers.some((s) => s.id === actor.id)).toBe(true);
  });

  // ===========================================================================
  // Store default tax category untouched by this phase (regression guard —
  // this phase must not alter commercial/business logic)
  // ===========================================================================
  it("regression: reading the report never mutates StoreConfiguration or any Sale", async () => {
    const actor = await makeActor();
    const before = await getStoreConfiguration();
    const { sale } = await makeConfirmedSale(actor.id, { totalAmount: 77000n });

    await listSalesForReport({});
    await getSalesReportSummary({});

    const after = await getStoreConfiguration();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const saleAfter = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(saleAfter.totalAmount).toBe(77000n);
  });
});
