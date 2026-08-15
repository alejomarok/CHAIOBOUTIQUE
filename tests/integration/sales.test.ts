// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import { adjustInventory, getInventoryBalance } from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import {
  cancelSale,
  CancellationReasonRequiredError,
  confirmSale,
  createSale,
  EmptySaleCannotBeConfirmedError,
  getSaleById,
  InsufficientSaleStockError,
  ProductVariantMissingPriceError,
  ProductVariantNotFoundError,
  SaleAlreadyCancelledError,
  SaleNotEditableError,
  updateSale,
} from "@/modules/sales/sale";
import { InvalidSaleItemError } from "@/modules/sales/totals";
import { createWarehouse, getDefaultWarehouse } from "@/modules/warehouses/service";

describe("sales — internal/manual sale foundation (real DB)", () => {
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
      name: "Sales Actor",
      email: `sales-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  // Deliberately no cleanup.push for category/product/variant below — a
  // confirmed/cancelled sale's SaleItem references the variant, and Sale
  // itself is never hard-deleted (see this phase's "prefer cancellation
  // over deletion" rule) — same "left for the isolated test database's
  // full reset" precedent as tests/integration/product-stock-summary.test.ts.
  async function makeSellableVariant(actorId: string, priceAmount: bigint | null = 150000n) {
    const category = await createCategory({ name: `Sales Cat ${Date.now()}-${Math.random()}` }, actorId);
    const product = await createProduct(
      { name: `Sales Producto ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [
        {
          sizeOptionId: null,
          colorId: null,
          sku: `SALE-SKU-${Date.now()}-${Math.random()}`,
          priceAmount,
        },
      ],
      actorId,
    );
    return variant;
  }

  // Every confirmSale/createSale({confirm:true})/updateSale({confirm:true})
  // call now atomically consumes real inventory (this phase's whole point)
  // — a variant with no InventoryBalance row has 0 available, so any test
  // that confirms a sale must seed real stock first, exactly like a real
  // warehouse receiving stock. Reuses the same adjustInventory/INITIAL_STOCK
  // path tests/integration/inventory.test.ts already established.
  async function seedStock(
    variantId: string,
    warehouseId: string,
    quantity: number,
    actorId: string,
  ) {
    await adjustInventory({
      variantId,
      warehouseId,
      quantityDelta: quantity,
      movementType: "INITIAL_STOCK",
      actorId,
    });
  }

  // reset-db.ts seeds exactly one default warehouse (seedDefaultWarehouse)
  // before every integration test file runs — sales that don't pass an
  // explicit warehouseId resolve to it (see sale-core.ts's
  // resolveWarehouseId), so tests that don't care about warehouse choice
  // specifically can rely on it always existing.
  async function getDefaultWarehouseId() {
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    return warehouse.id;
  }

  // Deliberately no cleanup.push: once a Sale references this customer
  // (Sale.customerId is onDelete: Restrict, per this phase's "commercial
  // history outlives casual edits" posture), the customer can never be
  // deleted afterward — attempting to would throw and, since `cleanup` is
  // one shared stack for the whole describe block, poison every other
  // test's afterEach that runs after it. Same "left for the isolated test
  // database's full reset" precedent as makeSellableVariant above and
  // tests/integration/product-stock-summary.test.ts.
  async function makePersonCustomer(actorId: string) {
    const result = await createCustomer(
      { type: "PERSON", firstName: "Cliente", lastName: `Ventas ${Date.now()}-${Math.random()}` },
      actorId,
    );
    if (result.status !== "created") throw new Error("unreachable");
    return result.customer;
  }

  async function getConsumidorFinal() {
    return prisma.customer.findFirstOrThrow({ where: { isSystemDefault: true } });
  }

  it("generates a sale code with the VEN- prefix", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    expect(sale.code).toMatch(/^VEN-/);
  });

  it("creates a draft sale with correct totals and a customer snapshot", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id, 100000n);

    const sale = await createSale(
      {
        customerId: customer.id,
        items: [{ productVariantId: variant.id, quantity: 2, discountAmount: 10000n }],
      },
      actor.id,
    );

    expect(sale.status).toBe("DRAFT");
    expect(sale.subtotalAmount).toBe(200000n);
    expect(sale.discountTotalAmount).toBe(10000n);
    expect(sale.totalAmount).toBe(190000n);
    expect(sale.taxTotalAmount).toBe(0n);
    expect(sale.customerNameSnapshot).toContain("Cliente");
    expect(sale.confirmedAt).toBeNull();

    const full = await getSaleById(sale.id);
    expect(full?.items).toHaveLength(1);
    expect(full?.items[0].productVariantId).toBe(variant.id);
    expect(full?.items[0].skuSnapshot).toBe(variant.sku);
  });

  it("creates a sale for Consumidor Final", async () => {
    const actor = await makeActor();
    const consumidorFinal = await getConsumidorFinal();
    const variant = await makeSellableVariant(actor.id);

    const sale = await createSale(
      { customerId: consumidorFinal.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    expect(sale.customerId).toBe(consumidorFinal.id);
    expect(sale.customerNameSnapshot).toContain("Consumidor");
  });

  it("resolves the unit price from the variant when not explicitly provided", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id, 250000n);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    const full = await getSaleById(sale.id);
    expect(full?.items[0].unitPriceAmount).toBe(250000n);
  });

  it("rejects adding a variant with no price configured anywhere", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id, null);

    await expect(
      createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
        actor.id,
      ),
    ).rejects.toThrow(ProductVariantMissingPriceError);
  });

  it("rejects a nonexistent product variant", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);

    await expect(
      createSale(
        { customerId: customer.id, items: [{ productVariantId: "nonexistent-id", quantity: 1 }] },
        actor.id,
      ),
    ).rejects.toThrow(ProductVariantNotFoundError);
  });

  it("confirms a sale with valid items and deducts stock", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 10, actor.id);

    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    const confirmed = await confirmSale(draft.id, actor.id);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).not.toBeNull();

    const balance = await getInventoryBalance(variant.id, warehouseId);
    expect(balance?.quantity).toBe(9);
  });

  it("creates directly as CONFIRMED when confirm: true", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);

    const sale = await createSale(
      {
        customerId: customer.id,
        items: [{ productVariantId: variant.id, quantity: 1 }],
        confirm: true,
      },
      actor.id,
    );
    expect(sale.status).toBe("CONFIRMED");
    expect(sale.confirmedAt).not.toBeNull();
  });

  it("rejects confirming a sale with no items", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);

    const draft = await createSale({ customerId: customer.id, items: [] }, actor.id);
    await expect(confirmSale(draft.id, actor.id)).rejects.toThrow(EmptySaleCannotBeConfirmedError);
  });

  it("rejects creating directly as CONFIRMED with no items", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);

    await expect(
      createSale({ customerId: customer.id, items: [], confirm: true }, actor.id),
    ).rejects.toThrow(EmptySaleCannotBeConfirmedError);
  });

  it("rejects an invalid (zero) quantity", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    await expect(
      createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 0 }] },
        actor.id,
      ),
    ).rejects.toThrow(InvalidSaleItemError);
  });

  it("rejects a negative unit price", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    await expect(
      createSale(
        {
          customerId: customer.id,
          items: [{ productVariantId: variant.id, quantity: 1, unitPriceAmount: -1n }],
        },
        actor.id,
      ),
    ).rejects.toThrow(InvalidSaleItemError);
  });

  it("rejects a negative discount", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    await expect(
      createSale(
        {
          customerId: customer.id,
          items: [{ productVariantId: variant.id, quantity: 1, discountAmount: -1n }],
        },
        actor.id,
      ),
    ).rejects.toThrow(InvalidSaleItemError);
  });

  it("prevents editing a CONFIRMED sale", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }], confirm: true },
      actor.id,
    );

    await expect(
      updateSale(sale.id, { items: [{ productVariantId: variant.id, quantity: 2 }] }, actor.id),
    ).rejects.toThrow(SaleNotEditableError);
  });

  it("prevents changing the warehouse of a CONFIRMED sale", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);
    const otherWarehouse = await createWarehouse(
      { code: `SALES-WH-${Date.now()}-${Math.random()}`, name: "Otro depósito" },
      actor.id,
    );

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }], confirm: true },
      actor.id,
    );
    expect(sale.warehouseId).toBe(warehouseId);

    await expect(
      updateSale(
        sale.id,
        { warehouseId: otherWarehouse.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
        actor.id,
      ),
    ).rejects.toThrow(SaleNotEditableError);
  });

  it("prevents editing a CANCELLED sale", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    await cancelSale(draft.id, "cambio de idea", actor.id);

    await expect(
      updateSale(draft.id, { items: [{ productVariantId: variant.id, quantity: 2 }] }, actor.id),
    ).rejects.toThrow(SaleNotEditableError);
  });

  it("updateSale replaces the item set and recomputes totals", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variantA = await makeSellableVariant(actor.id, 100000n);
    const variantB = await makeSellableVariant(actor.id, 200000n);

    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variantA.id, quantity: 1 }] },
      actor.id,
    );
    expect(draft.totalAmount).toBe(100000n);

    const updated = await updateSale(
      draft.id,
      { items: [{ productVariantId: variantB.id, quantity: 2 }] },
      actor.id,
    );
    expect(updated.totalAmount).toBe(400000n);

    const full = await getSaleById(draft.id);
    expect(full?.items).toHaveLength(1);
    expect(full?.items[0].productVariantId).toBe(variantB.id);
  });

  it("updateSale can confirm in the same call", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);

    const draft = await createSale({ customerId: customer.id, items: [] }, actor.id);
    const confirmed = await updateSale(
      draft.id,
      { items: [{ productVariantId: variant.id, quantity: 1 }], confirm: true },
      actor.id,
    );
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("cancels a DRAFT sale", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    const cancelled = await cancelSale(draft.id, "test", actor.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledById).toBe(actor.id);
    expect(cancelled.cancelReason).toBe("test");
  });

  it("cancels a CONFIRMED sale and restores stock", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 10, actor.id);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 3 }], confirm: true },
      actor.id,
    );
    let balance = await getInventoryBalance(variant.id, warehouseId);
    expect(balance?.quantity).toBe(7);

    const cancelled = await cancelSale(sale.id, "cliente se arrepintió", actor.id);
    expect(cancelled.status).toBe("CANCELLED");

    balance = await getInventoryBalance(variant.id, warehouseId);
    expect(balance?.quantity).toBe(10);
  });

  it("rejects cancelling without a reason", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    await expect(cancelSale(draft.id, "", actor.id)).rejects.toThrow(
      CancellationReasonRequiredError,
    );
    await expect(cancelSale(draft.id, "   ", actor.id)).rejects.toThrow(
      CancellationReasonRequiredError,
    );
  });

  it("rejects cancelling an already-cancelled sale", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);

    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    await cancelSale(draft.id, "motivo de prueba", actor.id);

    await expect(cancelSale(draft.id, "motivo de prueba", actor.id)).rejects.toThrow(
      SaleAlreadyCancelledError,
    );
  });

  it("records an audit entry for creation, confirmation, and cancellation", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const variant = await makeSellableVariant(actor.id);
    const warehouseId = await getDefaultWarehouseId();
    await seedStock(variant.id, warehouseId, 5, actor.id);

    const draft = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    await confirmSale(draft.id, actor.id);
    await cancelSale(draft.id, "motivo de prueba", actor.id);

    const entries = await prisma.auditLog.findMany({
      where: { entityType: "Sale", entityId: draft.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => e.action)).toEqual([
      "sale.created_draft",
      "sale.confirmed",
      "sale.cancelled",
    ]);
    expect(entries.every((e) => e.userId === actor.id)).toBe(true);
  });

  // =============================================================================
  // Sales → Inventory integration (this phase)
  // =============================================================================

  describe("stock integration", () => {
    it("a DRAFT sale does not consume any stock", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 10, actor.id);

      await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 4 }] },
        actor.id,
      );

      const balance = await getInventoryBalance(variant.id, warehouseId);
      expect(balance?.quantity).toBe(10);
      const movements = await prisma.inventoryMovement.count({
        where: { variantId: variant.id, warehouseId },
      });
      // Only the INITIAL_STOCK seed movement — nothing from the draft.
      expect(movements).toBe(1);
    });

    it("confirming deducts the exact requested quantity, across multiple variants", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variantA = await makeSellableVariant(actor.id, 100000n);
      const variantB = await makeSellableVariant(actor.id, 200000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variantA.id, warehouseId, 10, actor.id);
      await seedStock(variantB.id, warehouseId, 20, actor.id);

      await createSale(
        {
          customerId: customer.id,
          items: [
            { productVariantId: variantA.id, quantity: 3 },
            { productVariantId: variantB.id, quantity: 5 },
          ],
          confirm: true,
        },
        actor.id,
      );

      const balanceA = await getInventoryBalance(variantA.id, warehouseId);
      const balanceB = await getInventoryBalance(variantB.id, warehouseId);
      expect(balanceA?.quantity).toBe(7);
      expect(balanceB?.quantity).toBe(15);
    });

    it("stock is warehouse-specific — confirming against one warehouse never touches another", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseA = await createWarehouse(
        { code: `SALES-WA-${Date.now()}-${Math.random()}`, name: "Depósito Ventas A" },
        actor.id,
      );
      const warehouseB = await createWarehouse(
        { code: `SALES-WB-${Date.now()}-${Math.random()}`, name: "Depósito Ventas B" },
        actor.id,
      );
      await seedStock(variant.id, warehouseA.id, 10, actor.id);
      await seedStock(variant.id, warehouseB.id, 10, actor.id);

      await createSale(
        {
          customerId: customer.id,
          warehouseId: warehouseA.id,
          items: [{ productVariantId: variant.id, quantity: 6 }],
          confirm: true,
        },
        actor.id,
      );

      const balanceA = await getInventoryBalance(variant.id, warehouseA.id);
      const balanceB = await getInventoryBalance(variant.id, warehouseB.id);
      expect(balanceA?.quantity).toBe(4);
      expect(balanceB?.quantity).toBe(10);
    });

    it("rejects confirmation entirely when any item has insufficient stock — no partial deduction", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variantA = await makeSellableVariant(actor.id, 100000n);
      const variantB = await makeSellableVariant(actor.id, 200000n);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variantA.id, warehouseId, 10, actor.id);
      await seedStock(variantB.id, warehouseId, 2, actor.id);

      const draft = await createSale(
        {
          customerId: customer.id,
          items: [
            { productVariantId: variantA.id, quantity: 3 },
            { productVariantId: variantB.id, quantity: 4 },
          ],
        },
        actor.id,
      );

      await expect(confirmSale(draft.id, actor.id)).rejects.toThrow(InsufficientSaleStockError);

      const balanceA = await getInventoryBalance(variantA.id, warehouseId);
      const balanceB = await getInventoryBalance(variantB.id, warehouseId);
      expect(balanceA?.quantity).toBe(10); // untouched — variant A had enough stock
      expect(balanceB?.quantity).toBe(2); // untouched — the shortfall

      const stillDraft = await getSaleById(draft.id);
      expect(stillDraft?.status).toBe("DRAFT");
    });

    it("the insufficient-stock error names the product and the exact available/requested amounts", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 2, actor.id);

      const draft = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 4 }] },
        actor.id,
      );

      await expect(confirmSale(draft.id, actor.id)).rejects.toThrow(
        /Disponible: 2\nSolicitado: 4\./,
      );
    });

    it("cancellation restores the exact quantity to the original warehouse", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 10, actor.id);

      const sale = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 3 }], confirm: true },
        actor.id,
      );
      await cancelSale(sale.id, "devolución", actor.id);

      const balance = await getInventoryBalance(variant.id, warehouseId);
      expect(balance?.quantity).toBe(10);

      const movements = await prisma.inventoryMovement.findMany({
        where: { relatedEntityType: "Sale", relatedEntityId: sale.id },
        orderBy: { createdAt: "asc" },
      });
      expect(movements.map((m) => [m.movementType, m.quantityDelta])).toEqual([
        ["SALE", -3],
        ["SALE_CANCELLATION", 3],
      ]);
    });

    it("a DRAFT sale cancelled before confirmation creates no inventory movement", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 10, actor.id);

      const draft = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 5 }] },
        actor.id,
      );
      await cancelSale(draft.id, "no se concretó", actor.id);

      const balance = await getInventoryBalance(variant.id, warehouseId);
      expect(balance?.quantity).toBe(10);
      const movements = await prisma.inventoryMovement.count({
        where: { relatedEntityType: "Sale", relatedEntityId: draft.id },
      });
      expect(movements).toBe(0);
    });

    it("cannot restore stock twice — a second cancellation attempt is rejected", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 10, actor.id);

      const sale = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 3 }], confirm: true },
        actor.id,
      );
      await cancelSale(sale.id, "primer intento", actor.id);
      await expect(cancelSale(sale.id, "segundo intento", actor.id)).rejects.toThrow(
        SaleAlreadyCancelledError,
      );

      const balance = await getInventoryBalance(variant.id, warehouseId);
      expect(balance?.quantity).toBe(10); // restored once, not twice
    });

    it("inventory movements from a sale reference it via relatedEntityType/relatedEntityId", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 10, actor.id);

      const sale = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 2 }], confirm: true },
        actor.id,
      );

      const movement = await prisma.inventoryMovement.findFirstOrThrow({
        where: { variantId: variant.id, warehouseId, movementType: "SALE" },
      });
      expect(movement.relatedEntityType).toBe("Sale");
      expect(movement.relatedEntityId).toBe(sale.id);
    });

    it("two concurrent confirmations for the last unit of stock — only one succeeds, stock never goes negative", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 1, actor.id);

      const draftA = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
        actor.id,
      );
      const draftB = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
        actor.id,
      );

      const results = await Promise.allSettled([
        confirmSale(draftA.id, actor.id),
        confirmSale(draftB.id, actor.id),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        InsufficientSaleStockError,
      );

      const balance = await getInventoryBalance(variant.id, warehouseId);
      expect(balance?.quantity).toBe(0); // never negative
    });

    it("a duplicate confirmation attempt on the same sale is rejected without double-deducting", async () => {
      const actor = await makeActor();
      const customer = await makePersonCustomer(actor.id);
      const variant = await makeSellableVariant(actor.id);
      const warehouseId = await getDefaultWarehouseId();
      await seedStock(variant.id, warehouseId, 10, actor.id);

      const draft = await createSale(
        { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 3 }] },
        actor.id,
      );
      await confirmSale(draft.id, actor.id);
      // A second confirm attempt against the same already-CONFIRMED sale is
      // rejected by assertEditableDraft (status !== DRAFT) before the
      // idempotency key is ever re-exercised — belt-and-suspenders with the
      // same-request-race case above.
      await expect(confirmSale(draft.id, actor.id)).rejects.toThrow(SaleNotEditableError);

      const balance = await getInventoryBalance(variant.id, warehouseId);
      expect(balance?.quantity).toBe(7);
    });
  });
});
