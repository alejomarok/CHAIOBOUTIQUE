// Read-only diagnostic — inspects the N most recently created products in
// the CURRENT DATABASE_URL (the real dev database when run via `tsx`, never
// a test database) and reports the exact visibility-blocker chain, stock,
// and image/storage state for each. No writes, no credentials/URLs logged.
// Ad hoc, not part of any npm script. Extends diagnose-latest-product.ts to
// cover more than just the single newest row.
import "dotenv/config";

import { prisma } from "@/lib/db-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";
import { getEffectivePrice } from "@/modules/products/pricing";
import { getVisibilityBlockers } from "@/modules/products/visibility";

const LIMIT = Number(process.argv[2] ?? 10);

async function main() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    include: {
      category: true,
      sizeGroup: true,
      variants: true,
      images: true,
    },
  });

  if (products.length === 0) {
    console.log("No products exist in this database.");
    return;
  }

  const defaultWarehouse = await getDefaultWarehouse();
  const allVariantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const balances = defaultWarehouse
    ? await prisma.inventoryBalance.findMany({
        where: { variantId: { in: allVariantIds } },
        include: { warehouse: true },
      })
    : [];

  console.log(`Found ${products.length} product(s). Default warehouse: ${defaultWarehouse ? `${defaultWarehouse.name} (${defaultWarehouse.id})` : "NONE CONFIGURED"}`);
  console.log("=".repeat(100));

  for (const product of products) {
    console.log(`\n### ${product.name}`);
    console.log("id:", product.id);
    console.log("slug:", product.slug);
    console.log("status:", product.status);
    console.log("createdAt:", product.createdAt.toISOString());
    console.log("updatedAt:", product.updatedAt.toISOString());
    console.log(
      "category:",
      product.category
        ? `${product.category.name} (id=${product.category.id}, isActive=${product.category.isActive})`
        : "none",
    );
    console.log(
      "sizeGroup:",
      product.sizeGroup ? `${product.sizeGroup.name} (id=${product.sizeGroup.id})` : "none",
    );
    console.log("defaultPriceAmount:", product.defaultPriceAmount?.toString() ?? "null");

    const activeVariants = product.variants.filter((v) => v.isActive);
    console.log("variants total:", product.variants.length, "| active:", activeVariants.length);
    for (const variant of product.variants) {
      const price = getEffectivePrice({
        variantPriceAmount: variant.priceAmount,
        productDefaultPriceAmount: product.defaultPriceAmount,
      });
      const variantBalances = balances.filter((b) => b.variantId === variant.id);
      const stockStr =
        variantBalances.length > 0
          ? variantBalances.map((b) => `${b.warehouse.name}=${b.quantity}`).join(", ")
          : "no balance rows";
      console.log(
        `  - variant ${variant.id} sku=${variant.sku} isActive=${variant.isActive} ` +
          `priceAmount=${variant.priceAmount?.toString() ?? "null"} effectivePrice=${price?.toString() ?? "null"} ` +
          `stock=[${stockStr}]`,
      );
    }

    console.log("images total:", product.images.length);
    for (const image of product.images) {
      console.log(
        `  - image ${image.id} bucket=${image.bucket} path=${image.path} isPrimary=${image.isPrimary} contentType=${image.contentType} fileSize=${image.fileSize}`,
      );
    }

    const blockers = getVisibilityBlockers(product, product.variants);
    if (blockers.length === 0) {
      console.log("visibility: PUBLIC (no blockers)");
    } else {
      console.log("visibility: BLOCKED —");
      for (const blocker of blockers) {
        console.log(`  - [${blocker.code}] ${blocker.message}`);
      }
    }
    console.log("-".repeat(100));
  }
}

main()
  .catch((error) => {
    console.error("Diagnostic failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
