-- Size groups & category-aware sizing — see DATABASE.md "Catalog core" and
-- the SizeGroup/SizeOption comments in schema.prisma for the full
-- rationale. Replaces the old global `size` lookup table (a single "40"
-- shared by pants and footwear) with SizeGroup (a named sizing scheme) +
-- SizeOption (one concrete value within a group, unique only *within* that
-- group).
--
-- Hand-edited from the raw `prisma migrate diff` output (which would have
-- dropped `size` and `product_variant."sizeId"` outright, losing data).
-- This version instead:
--   1. Creates size_group/size_option first, and adds
--      category.defaultSizeGroupId / product.sizeGroupId before touching
--      any data, so the backfill in step 2 has somewhere to write.
--   2. Migrates every existing `size` row into a new "General (migrado)"
--      size_group, reusing the exact same `id` for each size_option row —
--      so product_variant's existing sizeId values keep pointing at valid
--      rows with zero row rewriting — and backfills
--      product.sizeGroupId for every product that has at least one sized
--      variant, so a migrated product never ends up with sizeGroupId NULL
--      while its variant points into GENERAL_MIGRATED (an inconsistent
--      state — see review round 2). Guarded by two preflight checks that
--      RAISE EXCEPTION and abort the whole migration rather than insert
--      bad data: (a) no legacy displayName may normalize to a null/blank
--      label, (b) no two legacy displayNames may normalize to the same
--      label (both would otherwise violate, or silently evade,
--      size_option's @@unique([sizeGroupId, normalizedLabel])).
--   3. Renames product_variant."sizeId" to "sizeOptionId" (preserving
--      values) instead of dropping and re-adding the column.
--   4. Re-points the FK and the 3 hand-written partial unique indexes
--      (see the very first migration, 20260728001747_...) at the renamed
--      column, then only drops the now-empty `size` table at the very end.
-- Neither previously applied migration is modified.
--
-- Before running this migration against any real database, run
-- `npm run preflight:size-groups` (read-only) and resolve every flagged
-- row by hand — see DATABASE.md's "Size-groups migration — legacy data
-- policy" for the exact policy and a worked example. Verified against
-- data shaped like the pre-migration tables by tests/migrations/
-- (`npm run test:migrations`), which never depends on this migration
-- already having been applied to the database it runs against.

-- CreateTable
CREATE TABLE "size_group" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "size_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_option" (
    "id" TEXT NOT NULL,
    "sizeGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalizedLabel" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "size_option_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "size_group_code_key" ON "size_group"("code");

-- CreateIndex
CREATE UNIQUE INDEX "size_option_sizeGroupId_code_key" ON "size_option"("sizeGroupId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "size_option_sizeGroupId_normalizedLabel_key" ON "size_option"("sizeGroupId", "normalizedLabel");

-- AddForeignKey
ALTER TABLE "size_option" ADD CONSTRAINT "size_option_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "size_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable (added before the data migration below, so the
-- Product.sizeGroupId backfill has a column to write into)
ALTER TABLE "category" ADD COLUMN "defaultSizeGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_defaultSizeGroupId_fkey" FOREIGN KEY ("defaultSizeGroupId") REFERENCES "size_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "product" ADD COLUMN "sizeGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "size_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data migration: every existing `size` row -> a "General (migrado)"
-- size_group (reusing `size.id` verbatim as `size_option.id`), plus a
-- backfill of every affected Product.sizeGroupId. Only runs at all if
-- there is at least one legacy row to migrate.
--
-- normalizedLabel is computed to match the application's slugify()
-- (lib/slug.ts: NFD-decompose, strip diacritics, lowercase, trim, collapse
-- non-alphanumerics to single hyphens) as closely as plain SQL allows:
-- lowercase, transliterate the common accented Spanish characters
-- (áéíóúüñ) to their unaccented ASCII equivalent, then collapse/trim like
-- the client does. Postgres has no unaccent() available without an extra
-- extension this project doesn't otherwise need, and translate() only
-- covers a fixed character set — if a legacy displayName uses an accented
-- character outside that set, the resulting label is still deterministic
-- and non-blank (regexp_replace collapses it to a hyphen), just not
-- guaranteed to exactly match what slugify() would produce for that same
-- string; review any such row by hand afterward.
DO $$
DECLARE
  legacy_size_count INTEGER;
  general_group_id TEXT := 'size_group_general_migrated';
  invalid_row RECORD;
  collision_row RECORD;
BEGIN
  SELECT count(*) INTO legacy_size_count FROM "size";

  IF legacy_size_count > 0 THEN
    -- Fail safely instead of inserting a null/blank normalizedLabel — a
    -- unique index can't catch this on its own (NULL is never "equal" to
    -- itself under standard SQL uniqueness, so a blank/null value would
    -- silently sail past size_option's
    -- @@unique([sizeGroupId, normalizedLabel])).
    SELECT s."id" AS bad_id, s."key" AS bad_code, s."displayName" AS bad_label
      INTO invalid_row
      FROM "size" s
      WHERE NULLIF(
              regexp_replace(
                regexp_replace(
                  translate(lower(trim(both ' ' from s."displayName")), 'áéíóúüñ', 'aeiouun'),
                  '[^a-z0-9]+', '-', 'g'
                ),
                '(^-+|-+$)', '', 'g'
              ),
              ''
            ) IS NULL
      LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Migration aborted: legacy size id=% (key=%, displayName=%) normalizes to an empty/invalid label. Fix or remove this row in "size" before re-running this migration.',
        invalid_row.bad_id, invalid_row.bad_code, invalid_row.bad_label;
    END IF;

    -- Preflight collision check: two legacy display names normalizing to
    -- the same value (e.g. two accent/casing/whitespace variants of the
    -- same word) would violate — or worse, silently intend to violate —
    -- size_option's @@unique([sizeGroupId, normalizedLabel]). Fail with a
    -- clear, descriptive message before any INSERT runs, rather than let
    -- a raw constraint-violation error surface mid-migration.
    SELECT computed.normalized_label AS bad_label, count(*) AS occurrences
      INTO collision_row
      FROM (
        SELECT
          NULLIF(
            regexp_replace(
              regexp_replace(
                translate(lower(trim(both ' ' from s."displayName")), 'áéíóúüñ', 'aeiouun'),
                '[^a-z0-9]+', '-', 'g'
              ),
              '(^-+|-+$)', '', 'g'
            ),
            ''
          ) AS normalized_label
        FROM "size" s
      ) AS computed
      GROUP BY computed.normalized_label
      HAVING count(*) > 1
      LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Migration aborted: % legacy sizes normalize to the same label "%". Resolve the naming collision in "size" (e.g. rename one of the duplicates) before re-running this migration.',
        collision_row.occurrences, collision_row.bad_label;
    END IF;

    INSERT INTO "size_group" (id, code, name, description, "isActive", "createdAt", "updatedAt")
    VALUES (
      general_group_id,
      'GENERAL_MIGRATED',
      'General (migrado)',
      'Grupo temporal creado automáticamente al migrar los talles existentes del catálogo global anterior (antes de que los talles fueran específicos por categoría). Revisar y reorganizar en grupos más específicos cuando sea posible.',
      true,
      now(),
      now()
    );

    INSERT INTO "size_option" (id, "sizeGroupId", code, label, "normalizedLabel", "sortOrder", "isActive", "createdAt", "updatedAt")
    SELECT
      s."id",
      general_group_id,
      s."key",
      s."displayName",
      NULLIF(
        regexp_replace(
          regexp_replace(
            translate(lower(trim(both ' ' from s."displayName")), 'áéíóúüñ', 'aeiouun'),
            '[^a-z0-9]+', '-', 'g'
          ),
          '(^-+|-+$)', '', 'g'
        ),
        ''
      ),
      s."displayOrder",
      s."isActive",
      now(),
      now()
    FROM "size" s;

    -- Backfill: a product whose variants include at least one sized
    -- variant (sizeId IS NOT NULL, i.e. it will end up pointing at a
    -- size_option under GENERAL_MIGRATED once the rename below runs)
    -- must land in that same group — otherwise it would be left with
    -- sizeGroupId = NULL while a variant points at an option in a group
    -- the product itself doesn't reference, an inconsistent state.
    -- Products with no sized variant (sizeId always NULL, or no variants
    -- at all) are correctly left untouched (NULL — no size group).
    UPDATE "product" AS p
    SET "sizeGroupId" = general_group_id
    WHERE EXISTS (
      SELECT 1
      FROM "product_variant" AS pv
      WHERE pv."productId" = p."id"
        AND pv."sizeId" IS NOT NULL
    );
  END IF;
END $$;

-- product_variant: drop everything that references the old "sizeId"
-- column/table before renaming, then recreate against "sizeOptionId" /
-- size_option. See DATABASE.md "Partial indexes" for why the 3
-- hand-written indexes below exist at all (Postgres treats any-NULL rows
-- as non-conflicting, so the plain @@unique alone can't stop duplicates
-- in the null-axis cases).

-- DropForeignKey
ALTER TABLE "product_variant" DROP CONSTRAINT "product_variant_sizeId_fkey";

-- DropIndex (the fully-specified-case unique, Prisma-tracked)
DROP INDEX "product_variant_productId_sizeId_colorId_key";

-- DropIndex (the 3 hand-written partial indexes, not Prisma-tracked)
DROP INDEX "product_variant_no_axis_unique";
DROP INDEX "product_variant_size_only_unique";
DROP INDEX "product_variant_color_only_unique";

-- Rename, not drop+add: preserves every existing variant's size
-- assignment. Values are still valid size_option ids — see the data
-- migration above, which reused `size.id` verbatim as `size_option.id`.
ALTER TABLE "product_variant" RENAME COLUMN "sizeId" TO "sizeOptionId";

-- AddForeignKey
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_sizeOptionId_fkey" FOREIGN KEY ("sizeOptionId") REFERENCES "size_option"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (fully-specified case)
CREATE UNIQUE INDEX "product_variant_productId_sizeOptionId_colorId_key" ON "product_variant"("productId", "sizeOptionId", "colorId");

-- CreateIndex (the 3 null-axis partial indexes, recreated against the
-- renamed column — same technique/definitions as the original migration,
-- see prisma/migrations/20260728001747_init_foundation_catalog_inventory/migration.sql)
CREATE UNIQUE INDEX product_variant_no_axis_unique
  ON product_variant("productId") WHERE "sizeOptionId" IS NULL AND "colorId" IS NULL;
CREATE UNIQUE INDEX product_variant_size_only_unique
  ON product_variant("productId", "sizeOptionId") WHERE "sizeOptionId" IS NOT NULL AND "colorId" IS NULL;
CREATE UNIQUE INDEX product_variant_color_only_unique
  ON product_variant("productId", "colorId") WHERE "colorId" IS NOT NULL AND "sizeOptionId" IS NULL;

-- DropTable (safe now: every row has been copied into size_option, and no
-- FK references this table anymore)
DROP TABLE "size";
