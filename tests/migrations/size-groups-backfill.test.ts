// @vitest-environment node
import "../integration/guard";

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

// Verifies the PENDING migration's data-preserving logic directly against
// the real file on disk — not a copy of its SQL — without depending on
// whether that migration has been applied to the shared `public` schema
// yet. Run via `npm run test:migrations` (vitest.migrations.config.ts —
// deliberately no globalSetup, deliberately a separate test directory from
// tests/integration/, see that config file's comment for why).
//
// Each test builds its own throwaway Postgres schema shaped like the OLD
// (pre-migration) tables — only the columns the migration's SQL actually
// reads/writes — runs the unmodified migration file against it, and
// asserts the result. Every schema created is tracked in `schemasToClean`
// and dropped in `afterEach`, regardless of whether the test passed or
// threw, so a failure never leaks a throwaway schema.
const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  "../../prisma/migrations/20260729181641_size_groups_category_aware_sizing/migration.sql",
);
const GENERAL_MIGRATED_GROUP_ID = "size_group_general_migrated";

function uniqueSchemaName(label: string): string {
  return `size_migration_test_${label}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

// No sizeGroupId/defaultSizeGroupId columns on category/product here,
// deliberately — the migration itself adds them via ALTER TABLE, matching
// genuine pre-migration schema shape. Pre-creating them would make the
// migration's own ADD COLUMN fail with "column already exists".
//
// The FK constraint and 4 indexes on product_variant below match the ones
// the very first migration (20260728001747_init_foundation_catalog_inventory)
// actually created — the migration under test DROPs them by these exact
// names before renaming the column, so they must genuinely exist here or
// that DROP CONSTRAINT/DROP INDEX fails with "does not exist" (caught by
// running this suite for real — see PR discussion).
async function createLegacyTables(schema: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schema}"."size" (
      "id" TEXT PRIMARY KEY,
      "key" TEXT NOT NULL,
      "displayName" TEXT NOT NULL,
      "displayOrder" INTEGER NOT NULL DEFAULT 0,
      "isActive" BOOLEAN NOT NULL DEFAULT true
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."category" ("id" TEXT PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."product" ("id" TEXT PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${schema}"."product_variant" (
      "id" TEXT PRIMARY KEY,
      "productId" TEXT NOT NULL,
      "sizeId" TEXT,
      "colorId" TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "${schema}"."product_variant"
      ADD CONSTRAINT "product_variant_sizeId_fkey"
      FOREIGN KEY ("sizeId") REFERENCES "${schema}"."size"("id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "product_variant_productId_sizeId_colorId_key"
      ON "${schema}"."product_variant"("productId", "sizeId", "colorId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "product_variant_no_axis_unique"
      ON "${schema}"."product_variant"("productId") WHERE "sizeId" IS NULL AND "colorId" IS NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "product_variant_size_only_unique"
      ON "${schema}"."product_variant"("productId", "sizeId") WHERE "sizeId" IS NOT NULL AND "colorId" IS NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "product_variant_color_only_unique"
      ON "${schema}"."product_variant"("productId", "colorId") WHERE "colorId" IS NOT NULL AND "sizeId" IS NULL
  `);
}

describe("size-groups migration — backfill preserves pre-migration data (real DB, isolated schema)", () => {
  const schemasToClean: string[] = [];

  afterEach(async () => {
    while (schemasToClean.length > 0) {
      const schema = schemasToClean.pop();
      if (schema) {
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    }
  });

  it("backfills Product.sizeGroupId, preserves ProductVariant.sizeOptionId (and its row id), and transliterates accented labels", async () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = uniqueSchemaName("main");
    schemasToClean.push(schema);

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await createLegacyTables(schema);

    const legacySizeId = "legacy-size-unico";
    const productWithSizedVariant = "legacy-product-with-size";
    const productWithoutSizedVariant = "legacy-product-without-size";
    const sizedVariantId = "legacy-variant-unico";
    const sizelessVariantId = "legacy-variant-no-size";

    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schema}"."size" (id, key, "displayName", "displayOrder", "isActive")
      VALUES ('${legacySizeId}', 'U', 'Único', 0, true)
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schema}"."product" (id) VALUES ('${productWithSizedVariant}'), ('${productWithoutSizedVariant}')
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schema}"."product_variant" (id, "productId", "sizeId", "colorId")
      VALUES
        ('${sizedVariantId}', '${productWithSizedVariant}', '${legacySizeId}', NULL),
        ('${sizelessVariantId}', '${productWithoutSizedVariant}', NULL, NULL)
    `);

    // Run the real, unmodified migration file — `SET search_path` scopes
    // every unqualified table reference inside it to this throwaway
    // schema instead of `public`. Sent as one call/round-trip so the
    // search_path setting is guaranteed to still be in effect for every
    // statement that follows it, regardless of how Prisma's connection
    // pooling behaves across separate calls.
    await prisma.$executeRawUnsafe(`SET search_path TO "${schema}"; ${migrationSql}`);

    const migratedProduct = await prisma.$queryRawUnsafe<{ sizeGroupId: string | null }[]>(
      `SELECT "sizeGroupId" FROM "${schema}"."product" WHERE id = '${productWithSizedVariant}'`,
    );
    expect(migratedProduct[0]?.sizeGroupId).toBe(GENERAL_MIGRATED_GROUP_ID);

    const untouchedProduct = await prisma.$queryRawUnsafe<{ sizeGroupId: string | null }[]>(
      `SELECT "sizeGroupId" FROM "${schema}"."product" WHERE id = '${productWithoutSizedVariant}'`,
    );
    expect(untouchedProduct[0]?.sizeGroupId).toBeNull();

    const migratedVariant = await prisma.$queryRawUnsafe<
      { id: string; sizeOptionId: string | null }[]
    >(
      `SELECT id, "sizeOptionId" FROM "${schema}"."product_variant" WHERE id = '${sizedVariantId}'`,
    );
    // Same row (id unchanged) — this is exactly what keeps
    // inventory_movement/inventory_balance (which reference a variant by
    // this id) correctly associated across the migration.
    expect(migratedVariant[0]?.id).toBe(sizedVariantId);
    expect(migratedVariant[0]?.sizeOptionId).toBe(legacySizeId);

    const sizelessVariant = await prisma.$queryRawUnsafe<{ sizeOptionId: string | null }[]>(
      `SELECT "sizeOptionId" FROM "${schema}"."product_variant" WHERE id = '${sizelessVariantId}'`,
    );
    expect(sizelessVariant[0]?.sizeOptionId).toBeNull();

    const migratedSizeOption = await prisma.$queryRawUnsafe<
      { sizeGroupId: string; code: string; label: string; normalizedLabel: string }[]
    >(
      `SELECT "sizeGroupId", code, label, "normalizedLabel" FROM "${schema}"."size_option" WHERE id = '${legacySizeId}'`,
    );
    expect(migratedSizeOption[0]?.sizeGroupId).toBe(GENERAL_MIGRATED_GROUP_ID);
    expect(migratedSizeOption[0]?.label).toBe("Único");
    // Transliterated ("unico"), not merely accent-stripped ("nico").
    expect(migratedSizeOption[0]?.normalizedLabel).toBe("unico");

    const legacySizeTableGone = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = '${schema}' AND table_name = 'size'
      ) AS "exists"
    `);
    expect(legacySizeTableGone[0]?.exists).toBe(false);
  });

  it("leaves a product with no sized variant untouched when there is no legacy size data at all", async () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = uniqueSchemaName("empty");
    schemasToClean.push(schema);

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await createLegacyTables(schema);
    // No "size" rows at all — the migration's DO block must be a no-op
    // (legacy_size_count = 0), never create GENERAL_MIGRATED, and never
    // touch product.sizeGroupId.

    const productId = "legacy-product-no-sizes-anywhere";
    await prisma.$executeRawUnsafe(`INSERT INTO "${schema}"."product" (id) VALUES ('${productId}')`);

    await prisma.$executeRawUnsafe(`SET search_path TO "${schema}"; ${migrationSql}`);

    const product = await prisma.$queryRawUnsafe<{ sizeGroupId: string | null }[]>(
      `SELECT "sizeGroupId" FROM "${schema}"."product" WHERE id = '${productId}'`,
    );
    expect(product[0]?.sizeGroupId).toBeNull();

    const generalGroup = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "${schema}"."size_group" WHERE id = '${GENERAL_MIGRATED_GROUP_ID}'`,
    );
    expect(generalGroup).toHaveLength(0);
  });

  it("aborts with a clear exception instead of inserting a blank normalizedLabel", async () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = uniqueSchemaName("blank");
    schemasToClean.push(schema);

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await createLegacyTables(schema);
    // A displayName made entirely of characters the normalization strips
    // to nothing (only punctuation) — must fail the migration loudly
    // rather than insert normalizedLabel = ''.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."size" (id, key, "displayName") VALUES ('blank-size', 'B', '***')`,
    );

    await expect(
      prisma.$executeRawUnsafe(`SET search_path TO "${schema}"; ${migrationSql}`),
    ).rejects.toThrow(/normalizes to an empty\/invalid label/);
  });

  it("aborts with a clear exception instead of inserting two colliding normalizedLabels", async () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = uniqueSchemaName("collision");
    schemasToClean.push(schema);

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await createLegacyTables(schema);
    // "Único" and "unico" normalize to the same label.
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schema}"."size" (id, key, "displayName") VALUES
        ('dup-size-1', 'U1', 'Único'),
        ('dup-size-2', 'U2', 'unico')
    `);

    await expect(
      prisma.$executeRawUnsafe(`SET search_path TO "${schema}"; ${migrationSql}`),
    ).rejects.toThrow(/normalize to the same label/);
  });
});
