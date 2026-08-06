// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { getPublicProductBySlug, listPublicProducts } from "@/modules/products/public-queries";
import { createProduct, createVariants, getProductById, setProductStatus } from "@/modules/products/service";
import { getVisibilityBlockers } from "@/modules/products/visibility";

// Mirrors admin/products/actions.ts's publishProductAction exactly: check
// as-if-ACTIVE, then drop the trivially-true NOT_ACTIVE_STATUS blocker —
// see that action's own doc comment for why. Reused here (not imported,
// since the action itself is a "use server" file with revalidatePath, which
// needs a real Next.js request context — exercised at the e2e tier instead,
// consistent with this repo's existing test-tier split) so this integration
// suite verifies the exact same blocker computation the real action makes.
function computePublishBlockers(product: { categoryId: string | null; defaultPriceAmount: bigint | null }, variants: { isActive: boolean; priceAmount: bigint | null }[]) {
  return getVisibilityBlockers({ status: "ACTIVE", ...product }, variants).filter(
    (b) => b.code !== "NOT_ACTIVE_STATUS",
  );
}

describe("product publish flow (real DB)", () => {
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

  async function setup() {
    const actor = await createTestUser({
      name: "Publish Flow Actor",
      email: `publish-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("an incomplete product (no category, no variants) reports exact blockers and is never published", async () => {
    const actor = await setup();

    const product = await createProduct({ name: `Incompleto ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const blockers = computePublishBlockers(product, []);
    expect(blockers.map((b) => b.code).sort()).toEqual(["NO_ACTIVE_VARIANTS", "NO_CATEGORY"].sort());
    // NOT_ACTIVE_STATUS is deliberately excluded — it's what publishing is about to fix, not an
    // independent missing requirement.
    expect(blockers.map((b) => b.code)).not.toContain("NOT_ACTIVE_STATUS");

    const unchanged = await getProductById(product.id);
    expect(unchanged?.status).toBe("DRAFT");
    expect(await getPublicProductBySlug(product.slug)).toBeNull();
  });

  it("a complete product (category, price, active variant) has zero publish blockers and appears publicly once activated", async () => {
    const actor = await setup();
    const category = await createCategory({ name: `Publish Categoria ${Date.now()}` }, actor.id);
    cleanup.push(() => prisma.category.delete({ where: { id: category.id } }));

    const product = await createProduct(
      { name: `Completo ${Date.now()}`, categoryId: category.id, defaultPriceAmount: 2500n },
      actor.id,
    );
    cleanup.push(() => prisma.product.delete({ where: { id: product.id } }));

    const variants = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `PUBFLOW-${Date.now()}` }],
      actor.id,
    );
    cleanup.push(() =>
      prisma.productVariant.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } }),
    );

    const reloaded = await getProductById(product.id);
    const blockers = computePublishBlockers(reloaded!, reloaded!.variants);
    expect(blockers).toEqual([]);

    await setProductStatus(product.id, "ACTIVE", actor.id);

    expect(await getPublicProductBySlug(product.slug)).not.toBeNull();
    const listed = await listPublicProducts({ search: product.name });
    expect(listed.find((p) => p.id === product.id)).toBeDefined();
  });
});
