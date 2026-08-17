// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import { adjustInventory } from "@/modules/inventory/service";
import {
  DuplicatePaymentSubmissionError,
  InvalidPaymentAmountError,
  PaymentAlreadyVoidedError,
  PaymentExceedsRemainingBalanceError,
  registerSalePayment,
  SaleCancelledCannotAcceptPaymentsError,
  SaleNotConfirmedError,
  VoidReasonRequiredError,
  voidSalePayment,
} from "@/modules/sales/payment";
import {
  cancelSale,
  createSale,
  SaleHasActivePaymentsError,
  getSaleById,
  listSales,
} from "@/modules/sales/sale";
import { createProduct, createVariants } from "@/modules/products/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

describe("sale payments — Sales Payments foundation (real DB)", () => {
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

  async function makeActor() {
    const actor = await createTestUser({
      name: "Payments Actor",
      email: `payments-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  // Same "no cleanup.push, left for the isolated test database's full
  // reset" precedent as tests/integration/sales.test.ts — a confirmed
  // sale's items/payments transitively reference these.
  async function makeSellableVariant(actorId: string, priceAmount: bigint = 150000n) {
    const category = await createCategory({ name: `Pay Cat ${Date.now()}-${Math.random()}` }, actorId);
    const product = await createProduct(
      { name: `Pay Producto ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [
        {
          sizeOptionId: null,
          colorId: null,
          sku: `PAY-SKU-${Date.now()}-${Math.random()}`,
          priceAmount,
        },
      ],
      actorId,
    );
    return variant;
  }

  async function getDefaultWarehouseId() {
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    return warehouse.id;
  }

  async function makePersonCustomer(actorId: string) {
    const result = await createCustomer(
      { type: "PERSON", firstName: "Cliente", lastName: `Pagos ${Date.now()}-${Math.random()}` },
      actorId,
    );
    if (result.status !== "created") throw new Error("unreachable");
    return result.customer;
  }

  // Every payment test starts from a real CONFIRMED sale (payments only
  // make sense once inventory has actually been committed) — this bundles
  // the stock seed + customer + confirm-on-create steps every test needs.
  async function makeConfirmedSale(actorId: string, totalAmount = 150000n, quantity = 1) {
    const customer = await makePersonCustomer(actorId);
    const unitPrice = totalAmount / BigInt(quantity);
    const variant = await makeSellableVariant(actorId, unitPrice);
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
    return sale;
  }

  it("a freshly confirmed sale with no payments is UNPAID", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    expect(sale.paidAmount).toBe(0n);
    expect(sale.paymentStatus).toBe("UNPAID");
  });

  it("a full payment marks the sale PAID with 0 remaining", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);

    const payment = await registerSalePayment(
      { saleId: sale.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );
    expect(payment.amount).toBe(100000n);
    expect(payment.status).toBe("ACTIVE");

    const updated = await getSaleById(sale.id);
    expect(updated?.paidAmount).toBe(100000n);
    expect(updated?.paymentStatus).toBe("PAID");
  });

  it("a partial payment marks the sale PARTIALLY_PAID with the correct remaining balance", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);

    await registerSalePayment(
      {
        saleId: sale.id,
        method: "BANK_TRANSFER",
        amount: 60000n,
        reference: "OP-123",
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    const updated = await getSaleById(sale.id);
    expect(updated?.paidAmount).toBe(60000n);
    expect(updated?.paymentStatus).toBe("PARTIALLY_PAID");
  });

  it("split payments across multiple methods sum correctly and reach PAID", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 150000n);

    await registerSalePayment(
      { saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );
    await registerSalePayment(
      { saleId: sale.id, method: "BANK_TRANSFER", amount: 40000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );
    await registerSalePayment(
      { saleId: sale.id, method: "DEBIT_CARD", amount: 60000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );

    const updated = await getSaleById(sale.id);
    expect(updated?.paidAmount).toBe(150000n);
    expect(updated?.paymentStatus).toBe("PAID");
    expect(updated?.payments).toHaveLength(3);
  });

  it("rejects a payment that would exceed the remaining balance, and persists nothing", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    await registerSalePayment(
      { saleId: sale.id, method: "BANK_TRANSFER", amount: 60000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );

    await expect(
      registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      ),
    ).rejects.toThrow(PaymentExceedsRemainingBalanceError);

    const updated = await getSaleById(sale.id);
    expect(updated?.paidAmount).toBe(60000n); // unchanged
    expect(updated?.payments).toHaveLength(1); // the rejected attempt left no row
  });

  it("rejects a zero payment amount", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    await expect(
      registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 0n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      ),
    ).rejects.toThrow(InvalidPaymentAmountError);
  });

  it("rejects a negative payment amount", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    await expect(
      registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: -1000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      ),
    ).rejects.toThrow(InvalidPaymentAmountError);
  });

  it("rejects registering a payment against a DRAFT sale", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );

    await expect(
      registerSalePayment(
        { saleId: draft.id, method: "CASH", amount: 150000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      ),
    ).rejects.toThrow(SaleNotConfirmedError);
  });

  it("rejects registering a payment against a CANCELLED sale", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    await cancelSale(sale.id, "cliente se arrepintió", actor.id);

    await expect(
      registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      ),
    ).rejects.toThrow(SaleCancelledCannotAcceptPaymentsError);
  });

  it("a duplicate idempotencyKey is rejected without double-charging the sale", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    const idempotencyKey = crypto.randomUUID();

    await registerSalePayment(
      { saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey },
      actor.id,
    );
    await expect(
      registerSalePayment({ saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey }, actor.id),
    ).rejects.toThrow(DuplicatePaymentSubmissionError);

    const updated = await getSaleById(sale.id);
    expect(updated?.paidAmount).toBe(50000n); // only the first attempt counted
    expect(updated?.payments).toHaveLength(1);
  });

  it("two concurrent payments for the same $50.000 remaining balance — only one succeeds, never overpaid", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    await registerSalePayment(
      { saleId: sale.id, method: "BANK_TRANSFER", amount: 50000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );

    const results = await Promise.allSettled([
      registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      ),
      registerSalePayment(
        { saleId: sale.id, method: "DEBIT_CARD", amount: 50000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PaymentExceedsRemainingBalanceError,
    );

    const updated = await getSaleById(sale.id);
    expect(updated?.paidAmount).toBe(100000n); // never 150.000
    expect(updated?.paymentStatus).toBe("PAID");
  });

  describe("voiding a payment", () => {
    it("voids an ACTIVE payment, excludes it from the paid total, and recomputes the status", async () => {
      const actor = await makeActor();
      const sale = await makeConfirmedSale(actor.id, 100000n);
      const payment = await registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      let updated = await getSaleById(sale.id);
      expect(updated?.paymentStatus).toBe("PAID");

      const voided = await voidSalePayment(payment.id, "monto incorrecto", actor.id);
      expect(voided.status).toBe("VOIDED");
      expect(voided.voidReason).toBe("monto incorrecto");
      expect(voided.voidedById).toBe(actor.id);
      // The original record is preserved, not deleted.
      expect(voided.amount).toBe(100000n);
      expect(voided.method).toBe("CASH");

      updated = await getSaleById(sale.id);
      expect(updated?.paidAmount).toBe(0n);
      expect(updated?.paymentStatus).toBe("UNPAID");
    });

    it("requires a non-empty reason", async () => {
      const actor = await makeActor();
      const sale = await makeConfirmedSale(actor.id, 100000n);
      const payment = await registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );

      await expect(voidSalePayment(payment.id, "", actor.id)).rejects.toThrow(VoidReasonRequiredError);
      await expect(voidSalePayment(payment.id, "   ", actor.id)).rejects.toThrow(
        VoidReasonRequiredError,
      );
    });

    it("rejects voiding an already-voided payment", async () => {
      const actor = await makeActor();
      const sale = await makeConfirmedSale(actor.id, 100000n);
      const payment = await registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      await voidSalePayment(payment.id, "primer intento", actor.id);

      await expect(voidSalePayment(payment.id, "segundo intento", actor.id)).rejects.toThrow(
        PaymentAlreadyVoidedError,
      );
    });

    it("voiding one of several split payments recomputes the remaining balance from the others", async () => {
      const actor = await makeActor();
      const sale = await makeConfirmedSale(actor.id, 150000n);
      await registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      const transfer = await registerSalePayment(
        { saleId: sale.id, method: "BANK_TRANSFER", amount: 40000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      await registerSalePayment(
        { saleId: sale.id, method: "DEBIT_CARD", amount: 60000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      let updated = await getSaleById(sale.id);
      expect(updated?.paymentStatus).toBe("PAID");

      await voidSalePayment(transfer.id, "transferencia rechazada", actor.id);

      updated = await getSaleById(sale.id);
      expect(updated?.paidAmount).toBe(110000n); // 50.000 + 60.000
      expect(updated?.paymentStatus).toBe("PARTIALLY_PAID");
    });

    it("voiding a payment never touches inventory — inventory follows Sale.status, not SalePayment.status", async () => {
      const actor = await makeActor();
      const warehouseId = await getDefaultWarehouseId();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id, 150000n);
      await adjustInventory({
        variantId: variant.id,
        warehouseId,
        quantityDelta: 10,
        movementType: "INITIAL_STOCK",
        actorId: actor.id,
      });
      const sale = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }], confirm: true },
        actor.id,
      );
      const balanceAfterConfirm = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { variantId_warehouseId: { variantId: variant.id, warehouseId } },
      });
      expect(balanceAfterConfirm.quantity).toBe(9);

      const payment = await registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 150000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      await voidSalePayment(payment.id, "error de carga", actor.id);

      const balanceAfterVoid = await prisma.inventoryBalance.findUniqueOrThrow({
        where: { variantId_warehouseId: { variantId: variant.id, warehouseId } },
      });
      expect(balanceAfterVoid.quantity).toBe(9); // unchanged by the void
    });
  });

  describe("Sale cancellation policy", () => {
    it("blocks cancelling a CONFIRMED sale that has an active payment", async () => {
      const actor = await makeActor();
      const sale = await makeConfirmedSale(actor.id, 100000n);
      await registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );

      await expect(cancelSale(sale.id, "cliente se arrepintió", actor.id)).rejects.toThrow(
        SaleHasActivePaymentsError,
      );

      const stillConfirmed = await getSaleById(sale.id);
      expect(stillConfirmed?.status).toBe("CONFIRMED");
    });

    it("allows cancelling once every active payment has been voided", async () => {
      const actor = await makeActor();
      const sale = await makeConfirmedSale(actor.id, 100000n);
      const payment = await registerSalePayment(
        { saleId: sale.id, method: "CASH", amount: 50000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      await voidSalePayment(payment.id, "venta se cancela", actor.id);

      const cancelled = await cancelSale(sale.id, "cliente se arrepintió", actor.id);
      expect(cancelled.status).toBe("CANCELLED");
    });
  });

  describe("listSales payment-status filtering", () => {
    it("filters by UNPAID/PARTIALLY_PAID/PAID", async () => {
      const actor = await makeActor();
      const unpaid = await makeConfirmedSale(actor.id, 100000n);
      const partial = await makeConfirmedSale(actor.id, 100000n);
      await registerSalePayment(
        { saleId: partial.id, method: "CASH", amount: 40000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );
      const paid = await makeConfirmedSale(actor.id, 100000n);
      await registerSalePayment(
        { saleId: paid.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
        actor.id,
      );

      const { sales: unpaidResults } = await listSales({ paymentStatus: "UNPAID", take: 200 });
      expect(unpaidResults.map((s) => s.id)).toContain(unpaid.id);
      expect(unpaidResults.map((s) => s.id)).not.toContain(partial.id);
      expect(unpaidResults.map((s) => s.id)).not.toContain(paid.id);

      const { sales: partialResults } = await listSales({ paymentStatus: "PARTIALLY_PAID", take: 200 });
      expect(partialResults.map((s) => s.id)).toContain(partial.id);
      expect(partialResults.map((s) => s.id)).not.toContain(unpaid.id);

      const { sales: paidResults } = await listSales({ paymentStatus: "PAID", take: 200 });
      expect(paidResults.map((s) => s.id)).toContain(paid.id);
      expect(paidResults.map((s) => s.id)).not.toContain(unpaid.id);
    });
  });

  it("records an audit entry for a payment registration and for a void", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    const payment = await registerSalePayment(
      { saleId: sale.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );
    await voidSalePayment(payment.id, "motivo de prueba", actor.id);

    const entries = await prisma.auditLog.findMany({
      where: { entityType: "SalePayment", entityId: payment.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => e.action)).toEqual(["sale_payment.registered", "sale_payment.voided"]);
    expect(entries.every((e) => e.userId === actor.id)).toBe(true);
  });
});
