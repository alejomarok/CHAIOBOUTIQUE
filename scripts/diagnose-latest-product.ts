// Read-only diagnostic — inspects the most recently created product in the
// CURRENT DATABASE_URL (the real dev database when run via `tsx`, never a
// test database) and reports the exact visibility-blocker chain. No writes,
// no credentials/URLs logged. Ad hoc, not part of any npm script.
import "dotenv/config";

import { prisma } from "@/lib/db-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";
import { getEffectivePrice } from "@/modules/products/pricing";
import { getVisibilityBlockers } from "@/modules/products/visibility";
// Deliberately NOT importing modules/products/public-queries.ts here — it
// has "server-only" guarding it (correctly, for app code) and this is a
// plain Node/tsx script. getVisibilityBlockers is the exact same single
// source of truth listPublicProducts/getPublicProductBySlug themselves
// call — "no blockers" IS "would appear in the public query," by
// construction (see modules/products/visibility.ts's own doc comment) — so
// nothing is lost by checking it directly instead of re-importing the
// guarded query file.

async function main() {
  const product = await prisma.product.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      sizeGroup: true,
      variants: true,
      images: true,
    },
  });

  if (!product) {
    console.log("No products exist in this database.");
    return;
  }

  console.log("id:", product.id);
  console.log("name:", product.name);
  console.log("slug:", product.slug);
  console.log("status:", product.status);
  console.log("createdAt:", product.createdAt.toISOString());
  console.log(
    "category:",
    product.category ? `${product.category.name} (id=${product.category.id}, isActive=${product.category.isActive})` : "none",
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
    console.log(
      `  variant ${variant.id} sku=${variant.sku} isActive=${variant.isActive} priceAmount=${variant.priceAmount?.toString() ?? "null"} effectivePrice=${price?.toString() ?? "null"}`,
    );
  }

  const defaultWarehouse = await getDefaultWarehouse();
  if (defaultWarehouse) {
    const balances = await prisma.inventoryBalance.findMany({
      where: { warehouseId: defaultWarehouse.id, variantId: { in: product.variants.map((v) => v.id) } },
    });
    console.log(
      "stock (default warehouse):",
      balances.map((b) => `${b.variantId}=${b.quantity}`).join(", ") || "no balance rows",
    );
  } else {
    console.log("stock: no default warehouse configured");
  }

  console.log("images total:", product.images.length);
  const primaryImage = product.images.find((i) => i.isPrimary);
  console.log("primary image:", primaryImage ? `${primaryImage.id} (path=${primaryImage.path})` : "none");

  const blockers = getVisibilityBlockers(product, product.variants);
  console.log("getVisibilityBlockers():", blockers.length === 0 ? "NONE (publicly visible)" : "");
  for (const blocker of blockers) {
    console.log(`  - [${blocker.code}] ${blocker.message}`);
  }

  // Both public query functions gate on this exact same check (see
  // modules/products/public-queries.ts) plus their own WHERE clauses
  // (status: ACTIVE, categoryId not null) — which are themselves just a
  // cheap pre-filter for the SAME conditions getVisibilityBlockers already
  // encodes. "No blockers" is definitive.
  const wouldAppearPublicly = blockers.length === 0;
  console.log("would appear in listPublicProducts()/getPublicProductBySlug():", wouldAppearPublicly);
}

main()
  .catch((error) => {
    console.error("Diagnostic failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
