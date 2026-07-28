// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createColor, createSize } from "@/modules/attributes/service";
import { DuplicateOperationError, InsufficientStockError } from "@/modules/inventory/errors";
import {
  adjustInventory,
  getInventoryBalance,
  transferInventory,
} from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import { createWarehouse } from "@/modules/warehouses/service";

describe("inventory — atomic movements, concurrency, idempotency (real DB)", () => {
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

  async function setupVariantAndWarehouses() {
    const actor = await createTestUser({
      name: "Inventory Actor",
      email: `inv-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Inv Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    const size = await createSize({ key: `IS-${Date.now()}`, displayName: "S" }, actor.id);
    cleanup.push(() => prisma.size.delete({ where: { id: size.id } }));
    const color = await createColor({ key: `ic-${Date.now()}`, displayName: "Negro" }, actor.id);
    cleanup.push(() => prisma.color.delete({ where: { id: color.id } }));

    const product = await createProduct(
      { name: `Inv Producto ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const [variant] = await createVariants(
      product.id,
      [{ sizeId: size.id, colorId: color.id, sku: `INV-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() => prisma.productVariant.delete({ where: { id: variant.id } }));

    const warehouseA = await createWarehouse(
      { code: `WA-${Date.now()}`, name: "Depósito A" },
      actor.id,
    );
    cleanup.push(() => prisma.warehouse.delete({ where: { id: warehouseA.id } }));
    const warehouseB = await createWarehouse(
      { code: `WB-${Date.now()}`, name: "Depósito B" },
      actor.id,
    );
    cleanup.push(() => prisma.warehouse.delete({ where: { id: warehouseB.id } }));

    return { actor, variant, warehouseA, warehouseB };
  }

  it("INITIAL_STOCK creates the balance and a matching movement", async () => {
    const { actor, variant, warehouseA } = await setupVariantAndWarehouses();

    const result = await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 50,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    expect(result.movements[0].previousQuantity).toBe(0);
    expect(result.movements[0].newQuantity).toBe(50);

    const balance = await getInventoryBalance(variant.id, warehouseA.id);
    expect(balance?.quantity).toBe(50);
  });

  it("rejects an adjustment that would take stock negative", async () => {
    const { actor, variant, warehouseA } = await setupVariantAndWarehouses();

    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 10,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    await expect(
      adjustInventory({
        variantId: variant.id,
        warehouseId: warehouseA.id,
        quantityDelta: -20,
        movementType: "ADJUSTMENT_OUT",
        actorId: actor.id,
      }),
    ).rejects.toThrow(InsufficientStockError);

    const balance = await getInventoryBalance(variant.id, warehouseA.id);
    expect(balance?.quantity).toBe(10); // unchanged
  });

  it("two concurrent adjustments never lose an update", async () => {
    const { actor, variant, warehouseA } = await setupVariantAndWarehouses();

    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 100,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    await Promise.all([
      adjustInventory({
        variantId: variant.id,
        warehouseId: warehouseA.id,
        quantityDelta: -10,
        movementType: "ADJUSTMENT_OUT",
        actorId: actor.id,
      }),
      adjustInventory({
        variantId: variant.id,
        warehouseId: warehouseA.id,
        quantityDelta: -15,
        movementType: "ADJUSTMENT_OUT",
        actorId: actor.id,
      }),
    ]);

    const balance = await getInventoryBalance(variant.id, warehouseA.id);
    expect(balance?.quantity).toBe(75); // 100 - 10 - 15, not a lost update
  });

  it("SUM(quantityDelta) always equals the current balance", async () => {
    const { actor, variant, warehouseA } = await setupVariantAndWarehouses();

    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 40,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: -5,
      movementType: "DAMAGE",
      actorId: actor.id,
    });

    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: variant.id, warehouseId: warehouseA.id },
    });
    const sum = movements.reduce((total, m) => total + m.quantityDelta, 0);

    const balance = await getInventoryBalance(variant.id, warehouseA.id);
    expect(balance?.quantity).toBe(sum);
  });

  it("rejects a duplicate idempotencyKey without double-applying", async () => {
    const { actor, variant, warehouseA } = await setupVariantAndWarehouses();
    const idempotencyKey = `test-key-${Date.now()}`;

    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 20,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
      idempotencyKey,
    });

    await expect(
      adjustInventory({
        variantId: variant.id,
        warehouseId: warehouseA.id,
        quantityDelta: 20,
        movementType: "INITIAL_STOCK",
        actorId: actor.id,
        idempotencyKey,
      }),
    ).rejects.toThrow(DuplicateOperationError);

    const balance = await getInventoryBalance(variant.id, warehouseA.id);
    expect(balance?.quantity).toBe(20); // applied once, not twice
  });

  it("a transfer creates TRANSFER_OUT/TRANSFER_IN under one operation and moves stock correctly", async () => {
    const { actor, variant, warehouseA, warehouseB } = await setupVariantAndWarehouses();

    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 30,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    const result = await transferInventory({
      variantId: variant.id,
      fromWarehouseId: warehouseA.id,
      toWarehouseId: warehouseB.id,
      quantity: 10,
      actorId: actor.id,
    });

    expect(result.movements).toHaveLength(2);
    expect(result.movements.map((m) => m.movementType).sort()).toEqual([
      "TRANSFER_IN",
      "TRANSFER_OUT",
    ]);
    expect(new Set(result.movements.map((m) => m.operationId)).size).toBe(1);

    const balanceA = await getInventoryBalance(variant.id, warehouseA.id);
    const balanceB = await getInventoryBalance(variant.id, warehouseB.id);
    expect(balanceA?.quantity).toBe(20);
    expect(balanceB?.quantity).toBe(10);
  });

  it("the database rejects a direct UPDATE on inventory_movement (append-only trigger)", async () => {
    const { actor, variant, warehouseA } = await setupVariantAndWarehouses();

    const result = await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 5,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    await expect(
      prisma.$executeRaw`UPDATE inventory_movement SET "quantityDelta" = 999 WHERE id = ${result.movements[0].id}`,
    ).rejects.toThrow();
  });

  it("the database rejects a direct DELETE on inventory_movement (append-only trigger)", async () => {
    const { actor, variant, warehouseA } = await setupVariantAndWarehouses();

    const result = await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseA.id,
      quantityDelta: 5,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    await expect(
      prisma.$executeRaw`DELETE FROM inventory_movement WHERE id = ${result.movements[0].id}`,
    ).rejects.toThrow();
  });
});
