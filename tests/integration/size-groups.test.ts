// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { cleanupSizeGroupFixtures } from "../fixtures/size-groups";
import { createCategory } from "@/modules/categories/service";
import { createSizeGroup, createSizeOption, listSizeOptions } from "@/modules/attributes/service";
import { adjustInventory, listInventoryBalances } from "@/modules/inventory/service";
import {
  createProduct,
  createVariants,
  ProductSizeGroupChangeBlockedError,
  updateProduct,
} from "@/modules/products/service";
import { createWarehouse } from "@/modules/warehouses/service";

describe("size groups — category-aware sizing (real DB)", () => {
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

  async function setupActor() {
    const actor = await createTestUser({
      name: "Size Groups Actor",
      email: `size-groups-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("allows the same label ('40') to exist in two different size groups", async () => {
    const actor = await setupActor();

    const pants = await createSizeGroup({ code: `PANTS-${Date.now()}`, name: "Pantalones" }, actor.id);
    const footwear = await createSizeGroup({ code: `FOOT-${Date.now()}`, name: "Calzado" }, actor.id);

    const pantsForty = await createSizeOption(
      { sizeGroupId: pants.id, code: "40", label: "40" },
      actor.id,
    );
    const footwearForty = await createSizeOption(
      { sizeGroupId: footwear.id, code: "40", label: "40" },
      actor.id,
    );
    cleanup.push(() =>
      cleanupSizeGroupFixtures({
        sizeOptionIds: [pantsForty.id, footwearForty.id],
        sizeGroupIds: [pants.id, footwear.id],
      }),
    );

    expect(pantsForty.id).not.toBe(footwearForty.id);
    expect(pantsForty.label).toBe("40");
    expect(footwearForty.label).toBe("40");
  });

  it("rejects a duplicate label within the same group (unique(sizeGroupId, normalizedLabel))", async () => {
    const actor = await setupActor();
    const group = await createSizeGroup({ code: `DUPLABEL-${Date.now()}`, name: "Grupo" }, actor.id);

    const first = await createSizeOption({ sizeGroupId: group.id, code: "A", label: "40" }, actor.id);
    cleanup.push(() =>
      cleanupSizeGroupFixtures({ sizeOptionIds: [first.id], sizeGroupIds: [group.id] }),
    );

    await expect(
      createSizeOption({ sizeGroupId: group.id, code: "B", label: "40" }, actor.id),
    ).rejects.toThrow();
  });

  it("a product inherits the category's default size group when not overridden", async () => {
    const actor = await setupActor();
    const group = await createSizeGroup(
      { code: `DEFGROUP-${Date.now()}`, name: "Grupo Default" },
      actor.id,
    );

    const category = await createCategory(
      { name: `Cat Default ${Date.now()}`, defaultSizeGroupId: group.id },
      actor.id,
    );

    const product = await createProduct(
      { name: `Producto heredado ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    cleanup.push(() =>
      cleanupSizeGroupFixtures({
        productIds: [product.id],
        categoryIds: [category.id],
        sizeGroupIds: [group.id],
      }),
    );

    expect(product.sizeGroupId).toBe(group.id);
  });

  it("a product can override the category's default size group", async () => {
    const actor = await setupActor();
    const defaultGroup = await createSizeGroup(
      { code: `OVR-DEF-${Date.now()}`, name: "Default" },
      actor.id,
    );
    const overrideGroup = await createSizeGroup(
      { code: `OVR-CUSTOM-${Date.now()}`, name: "Custom" },
      actor.id,
    );

    const category = await createCategory(
      { name: `Cat Override ${Date.now()}`, defaultSizeGroupId: defaultGroup.id },
      actor.id,
    );

    const product = await createProduct(
      {
        name: `Producto override ${Date.now()}`,
        categoryId: category.id,
        sizeGroupId: overrideGroup.id,
      },
      actor.id,
    );
    cleanup.push(() =>
      cleanupSizeGroupFixtures({
        productIds: [product.id],
        categoryIds: [category.id],
        sizeGroupIds: [defaultGroup.id, overrideGroup.id],
      }),
    );

    expect(product.sizeGroupId).toBe(overrideGroup.id);
  });

  it("a size-less product can be created, with no category and no size group", async () => {
    const actor = await setupActor();
    const product = await createProduct({ name: `Accesorio ${Date.now()}` }, actor.id);

    expect(product.sizeGroupId).toBeNull();

    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `ACC-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      cleanupSizeGroupFixtures({ variantIds: [variant.id], productIds: [product.id] }),
    );
    expect(variant.sizeOptionId).toBeNull();
  });

  it("listSizeOptions only returns options for the requested group, ordered by sortOrder (never alphabetically)", async () => {
    const actor = await setupActor();
    const groupA = await createSizeGroup({ code: `ORDER-A-${Date.now()}`, name: "Grupo A" }, actor.id);
    const groupB = await createSizeGroup({ code: `ORDER-B-${Date.now()}`, name: "Grupo B" }, actor.id);

    // sortOrder deliberately inverted from natural/alphabetical string order
    // ("10" would sort before "9" alphabetically) — proves sortOrder wins.
    const a10 = await createSizeOption(
      { sizeGroupId: groupA.id, code: "10", label: "10", sortOrder: 2 },
      actor.id,
    );
    const a9 = await createSizeOption(
      { sizeGroupId: groupA.id, code: "9", label: "9", sortOrder: 1 },
      actor.id,
    );
    const bOnly = await createSizeOption(
      { sizeGroupId: groupB.id, code: "1", label: "Unica" },
      actor.id,
    );
    cleanup.push(() =>
      cleanupSizeGroupFixtures({
        sizeOptionIds: [a10.id, a9.id, bOnly.id],
        sizeGroupIds: [groupA.id, groupB.id],
      }),
    );

    const options = await listSizeOptions(groupA.id);
    expect(options.map((o) => o.id)).toEqual([a9.id, a10.id]);
    expect(options.some((o) => o.id === bOnly.id)).toBe(false);
  });

  it("blocks changing a product's size group while an incompatible variant exists", async () => {
    const actor = await setupActor();
    const groupA = await createSizeGroup({ code: `CHG-A-${Date.now()}`, name: "Grupo A" }, actor.id);
    const groupB = await createSizeGroup({ code: `CHG-B-${Date.now()}`, name: "Grupo B" }, actor.id);

    const sizeA = await createSizeOption({ sizeGroupId: groupA.id, code: "A1", label: "A1" }, actor.id);

    const product = await createProduct(
      { name: `Producto cambio grupo ${Date.now()}`, sizeGroupId: groupA.id },
      actor.id,
    );

    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: sizeA.id, colorId: null, sku: `CHG-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      cleanupSizeGroupFixtures({
        variantIds: [variant.id],
        productIds: [product.id],
        sizeOptionIds: [sizeA.id],
        sizeGroupIds: [groupA.id, groupB.id],
      }),
    );

    await expect(updateProduct(product.id, { sizeGroupId: groupB.id }, actor.id)).rejects.toThrow(
      ProductSizeGroupChangeBlockedError,
    );

    const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(unchanged.sizeGroupId).toBe(groupA.id);
  });

  it("allows changing a product's size group once no incompatible variant remains", async () => {
    const actor = await setupActor();
    const groupA = await createSizeGroup({ code: `OK-A-${Date.now()}`, name: "Grupo A" }, actor.id);
    const groupB = await createSizeGroup({ code: `OK-B-${Date.now()}`, name: "Grupo B" }, actor.id);

    const product = await createProduct(
      { name: `Producto cambio libre ${Date.now()}`, sizeGroupId: groupA.id },
      actor.id,
    );
    cleanup.push(() =>
      cleanupSizeGroupFixtures({
        productIds: [product.id],
        sizeGroupIds: [groupA.id, groupB.id],
      }),
    );

    const updated = await updateProduct(product.id, { sizeGroupId: groupB.id }, actor.id);
    expect(updated.sizeGroupId).toBe(groupB.id);
  });

  it("inventory balances still resolve the sizeOption relation correctly for a sized variant", async () => {
    // Proxy for "existing inventory movements still work for migrated
    // variants": once the migration copies a legacy `size` row's id
    // verbatim into `size_option`, a migrated variant is indistinguishable
    // from a freshly created one like this — same FK value, same shape —
    // so this exercises exactly the read path a migrated variant would hit.
    const actor = await setupActor();
    const group = await createSizeGroup(
      { code: `INVREAD-${Date.now()}`, name: "Grupo Inventario" },
      actor.id,
    );
    const size = await createSizeOption(
      { sizeGroupId: group.id, code: "U", label: "Única" },
      actor.id,
    );

    const product = await createProduct(
      { name: `Producto inventario ${Date.now()}`, sizeGroupId: group.id },
      actor.id,
    );
    // Deliberately NO cleanup.push for group/size/product/variant/
    // warehouse below — this applies a real INITIAL_STOCK inventory
    // operation, which creates an InventoryMovement row. InventoryMovement
    // is append-only at the database level (a BEFORE UPDATE OR DELETE
    // trigger rejects it for every role, including this one — see
    // DATABASE.md "Append-only enforcement"), so that row can never be
    // deleted here — which means the ProductVariant it references can
    // never be deleted either (onDelete: Restrict), and transitively
    // neither can that variant's Product or SizeOption/SizeGroup. Calling
    // cleanupSizeGroupFixtures for this chain would just fail on the same
    // FK violation this whole fix exists to explain, not work around —
    // see that helper's doc comment. Same reasoning, same precedent, as
    // tests/integration/inventory.test.ts. The isolated test database's
    // full TRUNCATE-based reset (tests/integration/reset-db.ts) is what
    // actually clears this, between `npm run test:integration` runs.
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: size.id, colorId: null, sku: `INVREAD-${Date.now()}` }],
      actor.id,
    );
    const warehouse = await createWarehouse(
      { code: `INVREAD-WH-${Date.now()}`, name: "Depósito Inventario" },
      actor.id,
    );
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityDelta: 5,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });

    const balances = await listInventoryBalances({ warehouseId: warehouse.id });
    const balance = balances.find((b) => b.variantId === variant.id);
    expect(balance).toBeDefined();
    expect(balance?.variant.sizeOption?.label).toBe("Única");
    expect(balance?.quantity).toBe(5);
  });
});
