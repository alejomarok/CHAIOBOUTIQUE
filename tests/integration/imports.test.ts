// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { ImportBatchNotCancellableError } from "@/modules/imports/errors";
import { cancelImportBatch, runImport } from "@/modules/imports/service";
import { getInventoryBalance } from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import { createCategory } from "@/modules/categories/service";
import { createWarehouse } from "@/modules/warehouses/service";

describe("imports — CSV pipeline, idempotency, partial failure (real DB)", () => {
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
      name: "Imports Actor",
      email: `imports-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("dry run validates and records the batch but never touches the catalog", async () => {
    const actor = await setupActor();
    const sourceSystem = `test-src-${Date.now()}`;
    const legacyId = `CAT-${Date.now()}`;
    const csv = `legacyId,name,parentLegacyId,description,displayOrder\n${legacyId},Remeras Test,,,0\n`;

    const preview = await runImport(
      {
        importType: "CATEGORIES",
        sourceSystem,
        originalFilename: "categorias.csv",
        fileContents: csv,
        dryRun: true,
      },
      actor.id,
    );
    cleanup.push(() => prisma.importBatch.delete({ where: { id: preview.batch.id } }));

    expect(preview.batch.status).toBe("READY");
    expect(preview.batch.totalRows).toBe(1);
    expect(preview.batch.successfulRows).toBe(1);
    expect(preview.issues).toHaveLength(0);

    const notCreated = await prisma.category.findUnique({
      where: { legacySource_legacyId: { legacySource: sourceSystem, legacyId } },
    });
    expect(notCreated).toBeNull();
  });

  it("executes a CATEGORIES import, creating a real row keyed by (sourceSystem, legacyId)", async () => {
    const actor = await setupActor();
    const sourceSystem = `test-src-${Date.now()}`;
    const legacyId = `CAT-${Date.now()}`;
    const csv = `legacyId,name,parentLegacyId,description,displayOrder\n${legacyId},Remeras Test,,,0\n`;

    const result = await runImport(
      {
        importType: "CATEGORIES",
        sourceSystem,
        originalFilename: "categorias.csv",
        fileContents: csv,
        dryRun: false,
      },
      actor.id,
    );
    cleanup.push(() => prisma.importBatch.delete({ where: { id: result.batch.id } }));

    expect(result.batch.status).toBe("COMPLETED");
    expect(result.batch.successfulRows).toBe(1);
    expect(result.batch.failedRows).toBe(0);

    const created = await prisma.category.findUniqueOrThrow({
      where: { legacySource_legacyId: { legacySource: sourceSystem, legacyId } },
    });
    cleanup.push(() => prisma.category.delete({ where: { id: created.id } }));
    expect(created.name).toBe("Remeras Test");
  });

  it("re-running the same INITIAL_STOCK row is idempotent — never double-applies stock", async () => {
    const actor = await setupActor();
    const sourceSystem = `test-src-${Date.now()}`;

    // No cleanup.push for category/product/variant/warehouse here,
    // deliberately: this test applies a real INITIAL_STOCK inventory
    // operation against them, so they end up referenced by
    // inventory_balance/inventory_movement (onDelete: Restrict) —
    // genuinely undeletable afterward. The isolated test database's full
    // reset (tests/integration/reset-db.ts) clears this between
    // `npm run test:integration` runs instead. ImportBatch has no such
    // constraint (InventoryOperation.importBatchId is onDelete: SetNull,
    // not append-only), so its cleanup below stays.
    const category = await createCategory({ name: `Imports Categoria ${Date.now()}` }, actor.id);
    const product = await createProduct(
      { name: `Imports Producto ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeId: null, colorId: null, sku: `IMP-SKU-${Date.now()}` }],
      actor.id,
    );
    const warehouse = await createWarehouse(
      { code: `IMP-WH-${Date.now()}`, name: "Depósito Imports" },
      actor.id,
    );

    const csv = `sku,warehouseCode,quantity,legacyId\n${variant.sku},${warehouse.code},25,\n`;

    const first = await runImport(
      {
        importType: "INITIAL_STOCK",
        sourceSystem,
        originalFilename: "stock.csv",
        fileContents: csv,
        dryRun: false,
      },
      actor.id,
    );
    cleanup.push(() => prisma.importBatch.delete({ where: { id: first.batch.id } }));

    expect(first.batch.status).toBe("COMPLETED");
    expect(first.batch.successfulRows).toBe(1);
    expect((await getInventoryBalance(variant.id, warehouse.id))?.quantity).toBe(25);

    // A second attempt at the exact same row (same sourceSystem + sku +
    // warehouseCode => same deterministic idempotency key) — whether it's a
    // re-upload of the same file or a corrected re-export containing this
    // same row, it must not double-apply.
    const second = await runImport(
      {
        importType: "INITIAL_STOCK",
        sourceSystem,
        originalFilename: "stock-corrected.csv",
        fileContents: csv,
        dryRun: false,
      },
      actor.id,
    );
    cleanup.push(() => prisma.importBatch.delete({ where: { id: second.batch.id } }));

    expect(second.batch.status).toBe("COMPLETED");
    expect(second.batch.successfulRows).toBe(1); // idempotent no-op, not a failure
    expect(second.batch.failedRows).toBe(0);
    expect(second.issues.some((i) => i.errorCode === "ALREADY_IMPORTED")).toBe(true);

    expect((await getInventoryBalance(variant.id, warehouse.id))?.quantity).toBe(25); // unchanged
  });

  it("a bad row never rolls back rows already committed before it (partial failure)", async () => {
    const actor = await setupActor();
    const sourceSystem = `test-src-${Date.now()}`;

    // Same reasoning as the idempotency test above: this test applies real
    // inventory operations, so category/product/variant/warehouse cleanup
    // is omitted deliberately — see that test's comment.
    const category = await createCategory({ name: `Imports Categoria B ${Date.now()}` }, actor.id);
    const product = await createProduct(
      { name: `Imports Producto B ${Date.now()}`, categoryId: category.id },
      actor.id,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeId: null, colorId: null, sku: `IMP-SKU-B-${Date.now()}` }],
      actor.id,
    );
    const warehouseA = await createWarehouse(
      { code: `IMP-WA-${Date.now()}`, name: "Depósito A" },
      actor.id,
    );
    const warehouseB = await createWarehouse(
      { code: `IMP-WB-${Date.now()}`, name: "Depósito B" },
      actor.id,
    );

    const csv = [
      "sku,warehouseCode,quantity,legacyId",
      `${variant.sku},${warehouseA.code},5,`,
      `${variant.sku},DOES-NOT-EXIST,5,`,
      `${variant.sku},${warehouseB.code},7,`,
    ].join("\n");

    const result = await runImport(
      {
        importType: "INITIAL_STOCK",
        sourceSystem,
        originalFilename: "stock-partial.csv",
        fileContents: csv,
        dryRun: false,
      },
      actor.id,
    );
    cleanup.push(() => prisma.importBatch.delete({ where: { id: result.batch.id } }));

    expect(result.batch.status).toBe("COMPLETED_WITH_ERRORS");
    expect(result.batch.totalRows).toBe(3);
    expect(result.batch.successfulRows).toBe(2);
    expect(result.batch.failedRows).toBe(1);
    expect(result.issues.some((i) => i.errorCode === "WAREHOUSE_NOT_FOUND")).toBe(true);

    expect((await getInventoryBalance(variant.id, warehouseA.id))?.quantity).toBe(5);
    expect((await getInventoryBalance(variant.id, warehouseB.id))?.quantity).toBe(7);
  });

  it("a malformed CSV fails the whole batch with a CSV_PARSE_ERROR issue", async () => {
    const actor = await setupActor();

    const result = await runImport(
      {
        importType: "CATEGORIES",
        sourceSystem: `test-src-${Date.now()}`,
        originalFilename: "broken.csv",
        fileContents: 'legacyId,name\n"unterminated',
        dryRun: true,
      },
      actor.id,
    );
    cleanup.push(() => prisma.importBatch.delete({ where: { id: result.batch.id } }));

    expect(result.batch.status).toBe("FAILED");
    expect(result.issues[0].errorCode).toBe("CSV_PARSE_ERROR");
  });

  it("cancelImportBatch only allows cancelling a batch that hasn't executed yet", async () => {
    const actor = await setupActor();
    const csv = `legacyId,name\nCAT-${Date.now()},Categoria Cancelable\n`;

    const preview = await runImport(
      {
        importType: "CATEGORIES",
        sourceSystem: `test-src-${Date.now()}`,
        originalFilename: "cancelable.csv",
        fileContents: csv,
        dryRun: true,
      },
      actor.id,
    );
    cleanup.push(() => prisma.importBatch.delete({ where: { id: preview.batch.id } }));

    const cancelled = await cancelImportBatch(preview.batch.id, actor.id);
    expect(cancelled.status).toBe("CANCELLED");

    await expect(cancelImportBatch(preview.batch.id, actor.id)).rejects.toThrow(
      ImportBatchNotCancellableError,
    );
  });
});
