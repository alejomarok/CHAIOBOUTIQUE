import { prisma } from "@/lib/db";

// Deletes a SizeGroup/SizeOption/Category/Product/ProductVariant fixture
// chain in the one order Postgres's FK constraints actually require —
// InventoryBalance, then ProductVariant, then Product, then Category,
// then SizeOption, then SizeGroup — so a test never has to get this order
// right by hand. All fields are optional; pass only the ids a given test
// actually created. Safe to call with ids that reference nothing (e.g. no
// InventoryBalance ever existed for a variant) — deleteMany is a no-op in
// that case.
//
// Never call this for a chain where any variant has a real
// InventoryMovement attached (via adjustInventory/transferInventory —
// InventoryBalance is written as a side effect of the same call).
// InventoryMovement is append-only at the database level (a BEFORE UPDATE
// OR DELETE trigger rejects it for every role, including this one — see
// DATABASE.md "Append-only enforcement"), so the ProductVariant it
// references can never be deleted (onDelete: Restrict) — and
// transitively, neither can that variant's Product, SizeOption, or
// SizeGroup, no matter what this helper does; the deleteMany calls below
// would simply fail on the FK violation. That class of test (see
// tests/integration/inventory.test.ts, and
// tests/integration/size-groups.test.ts's "inventory balances still
// resolve..." test) deliberately leaves those rows behind and relies on
// the isolated test database's full TRUNCATE-based reset
// (tests/integration/reset-db.ts) between `npm run test:integration`
// invocations — do not call this helper from one.
export interface SizeGroupFixtureIds {
  variantIds?: string[];
  productIds?: string[];
  categoryIds?: string[];
  sizeOptionIds?: string[];
  sizeGroupIds?: string[];
}

export async function cleanupSizeGroupFixtures(ids: SizeGroupFixtureIds): Promise<void> {
  if (ids.variantIds?.length) {
    await prisma.inventoryBalance.deleteMany({ where: { variantId: { in: ids.variantIds } } });
    await prisma.productVariant.deleteMany({ where: { id: { in: ids.variantIds } } });
  }
  if (ids.productIds?.length) {
    await prisma.product.deleteMany({ where: { id: { in: ids.productIds } } });
  }
  if (ids.categoryIds?.length) {
    await prisma.category.deleteMany({ where: { id: { in: ids.categoryIds } } });
  }
  if (ids.sizeOptionIds?.length) {
    await prisma.sizeOption.deleteMany({ where: { id: { in: ids.sizeOptionIds } } });
  }
  if (ids.sizeGroupIds?.length) {
    await prisma.sizeGroup.deleteMany({ where: { id: { in: ids.sizeGroupIds } } });
  }
}
