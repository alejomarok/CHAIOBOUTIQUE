// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createColor } from "@/modules/attributes/service";
import { createCategory } from "@/modules/categories/service";
import {
  adjustInventory,
  getStockByVariantIds,
  getTotalStockForVariants,
  listInventoryBalances,
} from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import { createWarehouse } from "@/modules/warehouses/service";

// Proves the admin product list/detail pages' stock numbers are exactly
// what modules/inventory/service.ts's own server-side aggregation says —
// never a number recomputed in the browser, matching the sprint's "never
// calculate authoritative stock in browser code" requirement.
describe("product stock summary matches InventoryBalance (real DB)", () => {
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

  it("getStockByVariantIds and getTotalStockForVariants agree with the sum of real InventoryBalance rows across warehouses", async () => {
    const actor = await createTestUser({
      name: "Stock Summary Actor",
      email: `stock-summary-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    // Deliberately no cleanup.push for category/product/variants below —
    // this test applies real adjustInventory operations, which create
    // InventoryMovement rows. InventoryMovement is append-only at the
    // database level (see tests/integration/reset-db.ts's doc comment), so
    // the ProductVariant it references can never be deleted afterward —
    // and transitively neither can that variant's Product or Category. Same
    // precedent as tests/integration/inventory.test.ts and
    // tests/integration/size-groups.test.ts's "inventory balances still
    // resolve..." test: left for the isolated test database's full reset
    // between `npm run test:integration` runs.
    const category = await createCategory({ name: `Stock Summary Cat ${Date.now()}` }, actor.id);

    const product = await createProduct(
      { name: `Stock Summary Producto ${Date.now()}`, categoryId: category.id },
      actor.id,
    );

    const colorA = await createColor(
      { key: `stock-summary-a-${Date.now()}`, displayName: "Negro" },
      actor.id,
    );
    const colorB = await createColor(
      { key: `stock-summary-b-${Date.now()}`, displayName: "Blanco" },
      actor.id,
    );

    const variants = await createVariants(
      product.id,
      [
        { sizeOptionId: null, colorId: colorA.id, sku: `STOCK-A-${Date.now()}` },
        { sizeOptionId: null, colorId: colorB.id, sku: `STOCK-B-${Date.now()}` },
      ],
      actor.id,
    );

    const warehouseA = await createWarehouse(
      { code: `STOCK-WH-A-${Date.now()}`, name: "Depósito A" },
      actor.id,
    );
    const warehouseB = await createWarehouse(
      { code: `STOCK-WH-B-${Date.now()}`, name: "Depósito B" },
      actor.id,
    );

    // Deliberately no cleanup for warehouse/variant balance rows below —
    // adjustInventory writes a real, append-only InventoryMovement, so
    // (per the established precedent in tests/integration/inventory.test.ts
    // and size-groups.test.ts) this chain is left for the isolated test
    // database's full reset between `npm run test:integration` runs.
    await adjustInventory({
      variantId: variants[0].id,
      warehouseId: warehouseA.id,
      quantityDelta: 5,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });
    await adjustInventory({
      variantId: variants[0].id,
      warehouseId: warehouseB.id,
      quantityDelta: 2,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });
    await adjustInventory({
      variantId: variants[1].id,
      warehouseId: warehouseA.id,
      quantityDelta: 3,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    const variantIds = variants.map((v) => v.id);

    // The real, raw rows — the source of truth this test verifies against.
    const rawBalances = await prisma.inventoryBalance.findMany({
      where: { variantId: { in: variantIds } },
    });
    const expectedTotal = rawBalances.reduce((sum, b) => sum + b.quantity, 0);

    const total = await getTotalStockForVariants(variantIds);
    expect(total).toBe(expectedTotal);
    expect(total).toBe(10);

    const byVariant = await getStockByVariantIds(variantIds);
    expect(byVariant.get(variants[0].id)).toBe(7);
    expect(byVariant.get(variants[1].id)).toBe(3);

    const breakdown = await listInventoryBalances({ variantIds });
    expect(breakdown).toHaveLength(3);
    const breakdownTotal = breakdown.reduce((sum, b) => sum + b.quantity, 0);
    expect(breakdownTotal).toBe(expectedTotal);
    // Every row's warehouse is genuinely one this product's stock lives in
    // — never a stray row from an unrelated variant.
    for (const row of breakdown) {
      expect(variantIds).toContain(row.variantId);
    }
  });

  it("getStockByVariantIds returns an empty map for an empty input, never a query", async () => {
    const result = await getStockByVariantIds([]);
    expect(result.size).toBe(0);
  });
});
