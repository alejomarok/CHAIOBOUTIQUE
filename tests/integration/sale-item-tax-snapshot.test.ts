// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import { adjustInventory } from "@/modules/inventory/service";
import { createProduct, createVariants, updateProduct } from "@/modules/products/service";
import { createSale } from "@/modules/sales/sale";
import { getStoreConfiguration, updateStoreConfiguration } from "@/modules/store-settings/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

// Phase — ARCA Fiscal Readiness correction pass (item 4: snapshot tax data
// at Sale time; item 3: store default + Product override, never silently
// backfilled). Real DB — proves the actual resolution priority (Product
// override > StoreConfiguration default > null) and the historical-
// immutability guarantee, not just the pure resolver's own unit tests.
describe("SaleItem tax snapshot (real DB)", () => {
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
      name: "Tax Snapshot Actor",
      email: `tax-snapshot-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  async function setStoreDefaultTaxCategoryAfterTest(actorId: string, category: null | "IVA_21") {
    const before = await getStoreConfiguration();
    cleanup.push(() => updateStoreConfiguration({ defaultTaxCategory: before.defaultTaxCategory }, actorId));
    await updateStoreConfiguration({ defaultTaxCategory: category }, actorId);
  }

  async function makeProductWithVariant(actorId: string, priceAmount: bigint, taxCategoryOverride?: "IVA_10_5" | null) {
    const category = await createCategory({ name: `Tax Cat ${Date.now()}-${Math.random()}` }, actorId);
    const product = await createProduct(
      {
        name: `Tax Producto ${Date.now()}-${Math.random()}`,
        categoryId: category.id,
        defaultPriceAmount: priceAmount,
        ...(taxCategoryOverride !== undefined ? { taxCategory: taxCategoryOverride } : {}),
      },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `TAX-SKU-${Date.now()}-${Math.random()}` }],
      actorId,
    );
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityDelta: 10,
      movementType: "INITIAL_STOCK",
      actorId,
    });
    return { product, variant };
  }

  async function makeCustomer(actorId: string) {
    const result = await createCustomer(
      { type: "PERSON", firstName: "Snapshot", lastName: `Cliente ${Date.now()}` },
      actorId,
    );
    if (result.status !== "created") throw new Error("unreachable");
    return result.customer;
  }

  it("snapshots the Product's own override, even when a store default is also set", async () => {
    const actor = await makeActor();
    await setStoreDefaultTaxCategoryAfterTest(actor.id, "IVA_21");
    const { variant } = await makeProductWithVariant(actor.id, 100_000n, "IVA_10_5");
    const customer = await makeCustomer(actor.id);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );

    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.taxCategory).toBe("IVA_10_5");
    expect(item.taxRateBasisPoints).toBe(1050);
  });

  it("falls back to the store default when the Product has no override", async () => {
    const actor = await makeActor();
    await setStoreDefaultTaxCategoryAfterTest(actor.id, "IVA_21");
    const { variant } = await makeProductWithVariant(actor.id, 100_000n, null);
    const customer = await makeCustomer(actor.id);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );

    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.taxCategory).toBe("IVA_21");
    expect(item.taxRateBasisPoints).toBe(2100);
  });

  it("snapshots null on both fields when neither Product nor store has a configured category — never guessed", async () => {
    const actor = await makeActor();
    await setStoreDefaultTaxCategoryAfterTest(actor.id, null);
    const { variant } = await makeProductWithVariant(actor.id, 100_000n, null);
    const customer = await makeCustomer(actor.id);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );

    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.taxCategory).toBeNull();
    expect(item.taxRateBasisPoints).toBeNull();
  });

  it("a CONFIRMED Sale's tax snapshot never changes when the Product's own taxCategory is edited afterward", async () => {
    const actor = await makeActor();
    await setStoreDefaultTaxCategoryAfterTest(actor.id, null);
    const { product, variant } = await makeProductWithVariant(actor.id, 100_000n, "IVA_10_5");
    const customer = await makeCustomer(actor.id);

    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }], confirm: true },
      actor.id,
    );
    const originalItem = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(originalItem.taxCategory).toBe("IVA_10_5");

    // Change the Product's own tax category AFTER the Sale is confirmed —
    // this phase's explicit "a Sale must not change fiscally because
    // someone changes a Product's tax configuration tomorrow" requirement.
    await updateProduct(product.id, { taxCategory: "IVA_27" }, actor.id);

    const refreshedItem = await prisma.saleItem.findUniqueOrThrow({ where: { id: originalItem.id } });
    expect(refreshedItem.taxCategory).toBe("IVA_10_5");
    expect(refreshedItem.taxRateBasisPoints).toBe(1050);
  });

  it("does not silently backfill a tax category onto a SaleItem that predates this feature (simulated via direct null check)", async () => {
    // The migration itself is purely additive (no backfill) — this asserts
    // the STILL-CURRENT behavior a fresh, never-updated SaleItem row would
    // have: both fields genuinely absent, not defaulted to some category.
    const actor = await makeActor();
    await setStoreDefaultTaxCategoryAfterTest(actor.id, null);
    const { variant } = await makeProductWithVariant(actor.id, 50_000n, null);
    const customer = await makeCustomer(actor.id);
    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] },
      actor.id,
    );
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.taxCategory).toBeNull();
  });
});
