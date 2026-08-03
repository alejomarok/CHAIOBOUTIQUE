// Read-only preflight report for the size-groups migration
// (prisma/migrations/20260729181641_size_groups_category_aware_sizing).
// Run this against a database BEFORE applying that migration to see
// exactly which legacy `size` rows its two safety guards (blank/invalid
// normalizedLabel, duplicate normalizedLabel — both raise an exception and
// abort the whole migration transaction, never silently drop/merge data)
// would reject, and what products/variants reference them, so a human can
// decide how to resolve each one. This script makes NO changes to any
// database — every query below is a SELECT.
//
// Usage:
//   tsx scripts/preflight-size-groups-migration.ts
// Reads DATABASE_URL/DIRECT_URL the same way every other script in this
// repo does (.env, or overridden via scripts/with-test-db.mjs) — point it
// at whichever database you're about to migrate. See DATABASE.md's
// "Size-groups migration — legacy data policy" for how to act on its
// output: for the disposable Docker test database, recreate it rather
// than hand-fixing rows; for Supabase (dev/prod), every flagged row must
// be resolved by a human before the migration can run.
//
// Runs via `tsx`, outside the Next.js bundler — same "-core" import
// convention as prisma/seed.ts, so the import graph is plain Node.js.
import "dotenv/config";

import { prisma } from "@/lib/db-core";

interface FlaggedSizeRow {
  id: string;
  key: string;
  displayName: string;
  normalizedLabel: string | null;
}

interface ReferencingVariant {
  sizeId: string;
  variantId: string;
  sku: string;
  productId: string;
  productName: string | null;
  productSlug: string | null;
}

// Mirrors the migration's own normalization expression exactly — see that
// migration.sql's DO block comment for why plain SQL translate() is used
// instead of full NFD-decompose diacritic stripping.
const NORMALIZE_EXPRESSION = `
  NULLIF(
    regexp_replace(
      regexp_replace(
        translate(lower(trim(both ' ' from "displayName")), 'áéíóúüñ', 'aeiouun'),
        '[^a-z0-9]+', '-', 'g'
      ),
      '(^-+|-+$)', '', 'g'
    ),
    ''
  )
`;

async function sizeTableExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'size'
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function findBlankOrInvalidLabels(): Promise<FlaggedSizeRow[]> {
  return prisma.$queryRawUnsafe<FlaggedSizeRow[]>(`
    SELECT id, key, "displayName", ${NORMALIZE_EXPRESSION} AS "normalizedLabel"
    FROM "size"
    WHERE ${NORMALIZE_EXPRESSION} IS NULL
    ORDER BY key
  `);
}

async function findDuplicateLabels(): Promise<FlaggedSizeRow[]> {
  return prisma.$queryRawUnsafe<FlaggedSizeRow[]>(`
    WITH computed AS (
      SELECT id, key, "displayName", ${NORMALIZE_EXPRESSION} AS normalized_label
      FROM "size"
    )
    SELECT id, key, "displayName", normalized_label AS "normalizedLabel"
    FROM computed
    WHERE normalized_label IS NOT NULL
      AND normalized_label IN (
        SELECT normalized_label
        FROM computed
        WHERE normalized_label IS NOT NULL
        GROUP BY normalized_label
        HAVING count(*) > 1
      )
    ORDER BY normalized_label, key
  `);
}

async function findReferencingVariants(sizeIds: string[]): Promise<ReferencingVariant[]> {
  if (sizeIds.length === 0) return [];
  return prisma.$queryRawUnsafe<ReferencingVariant[]>(
    `
    SELECT
      pv."sizeId" AS "sizeId",
      pv.id AS "variantId",
      pv.sku,
      pv."productId" AS "productId",
      p.name AS "productName",
      p.slug AS "productSlug"
    FROM product_variant pv
    LEFT JOIN product p ON p.id = pv."productId"
    WHERE pv."sizeId" = ANY($1::text[])
    ORDER BY pv."sizeId", pv.sku
  `,
    sizeIds,
  );
}

function printFlagged(title: string, rows: FlaggedSizeRow[]): void {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (rows.length === 0) {
    console.log("None.");
    return;
  }
  for (const row of rows) {
    const normalized = row.normalizedLabel === null ? "NULL" : JSON.stringify(row.normalizedLabel);
    console.log(
      `- id=${row.id}  key=${row.key}  displayName=${JSON.stringify(row.displayName)}  normalizedLabel=${normalized}`,
    );
  }
}

function printReferences(rows: ReferencingVariant[]): void {
  console.log(`\n=== Products/variants referencing flagged size rows (${rows.length}) ===`);
  if (rows.length === 0) {
    console.log("None — every flagged size row is currently unused by any variant.");
    return;
  }
  for (const row of rows) {
    console.log(
      `- sizeId=${row.sizeId}  variant=${row.variantId} (sku=${row.sku})  ` +
        `product=${row.productId} (name=${row.productName ?? "?"}, slug=${row.productSlug ?? "?"})`,
    );
  }
}

async function main() {
  if (!(await sizeTableExists())) {
    console.log(
      'No "size" table found in this database — either the size-groups migration is ' +
        "already applied here, or this database never had the old Size model. Nothing to check.",
    );
    return;
  }

  const blank = await findBlankOrInvalidLabels();
  const duplicates = await findDuplicateLabels();

  printFlagged("Blank/invalid normalized labels", blank);
  printFlagged("Duplicate normalized labels (would collide within GENERAL_MIGRATED)", duplicates);

  const flaggedIds = [...new Set([...blank, ...duplicates].map((row) => row.id))];
  const references = await findReferencingVariants(flaggedIds);
  printReferences(references);

  const totalFlagged = blank.length + duplicates.length;
  if (totalFlagged > 0) {
    console.log(
      `\n${totalFlagged} row(s) flagged. The migration runs in one transaction and will ` +
        "RAISE EXCEPTION and abort cleanly (no partial changes) if applied as-is — it never " +
        "silently drops or merges anything. Resolve every flagged row by hand first (rename a " +
        "displayName, or deliberately consolidate confirmed duplicates onto one size before " +
        "removing the others) — see DATABASE.md's \"Size-groups migration — legacy data policy\".",
    );
    process.exitCode = 1;
  } else {
    console.log("\nNo blocking rows found — the migration's guards will pass.");
  }
}

main()
  .catch((error) => {
    console.error("Preflight check failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
