// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import {
  archiveCategory,
  CategoryCycleError,
  createCategory,
  listStorefrontNavCategories,
  updateCategory,
} from "@/modules/categories/service";

describe("categories — hierarchy and cycle prevention (real DB)", () => {
  const createdUserIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterEach(async () => {
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
    createdCategoryIds.length = 0;
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  it("rejects setting a category's own descendant as its parent (cycle)", async () => {
    const actor = await createTestUser({
      name: "Cat Actor",
      email: `cat-actor-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const parent = await createCategory({ name: `Ropa ${Date.now()}` }, actor.id);
    createdCategoryIds.push(parent.id);
    const child = await createCategory(
      { name: `Remeras ${Date.now()}`, parentId: parent.id },
      actor.id,
    );
    createdCategoryIds.push(child.id);

    await expect(updateCategory(parent.id, { parentId: child.id }, actor.id)).rejects.toThrow(
      CategoryCycleError,
    );
  });

  it("rejects a category being set as its own parent", async () => {
    const actor = await createTestUser({
      name: "Cat Actor 2",
      email: `cat-actor2-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const category = await createCategory({ name: `Pantalones ${Date.now()}` }, actor.id);
    createdCategoryIds.push(category.id);

    await expect(updateCategory(category.id, { parentId: category.id }, actor.id)).rejects.toThrow(
      CategoryCycleError,
    );
  });

  it("allows a valid, non-cyclic re-parenting", async () => {
    const actor = await createTestUser({
      name: "Cat Actor 3",
      email: `cat-actor3-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const a = await createCategory({ name: `Categoria A ${Date.now()}` }, actor.id);
    createdCategoryIds.push(a.id);
    const b = await createCategory({ name: `Categoria B ${Date.now()}` }, actor.id);
    createdCategoryIds.push(b.id);

    const updated = await updateCategory(b.id, { parentId: a.id }, actor.id);
    expect(updated.parentId).toBe(a.id);
  });
});

// Phase: public navbar curation. A category satisfying every OTHER loose
// criterion (top-level, active, has products) must still never reach the
// public nav/home tiles unless explicitly opted in — this is the actual
// regression test for "QA/test categories cannot break the storefront nav
// again." See modules/categories/service-core.ts's listStorefrontNavCategories
// and the Category.showInStorefrontNav schema comment.
describe("listStorefrontNavCategories — public nav curation (real DB)", () => {
  const createdUserIds: string[] = [];
  const createdCategoryIds: string[] = [];

  afterEach(async () => {
    await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
    createdCategoryIds.length = 0;
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function makeActor() {
    const actor = await createTestUser({
      name: "Nav Curation Actor",
      email: `nav-curation-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("a category created without opting in never appears, even though it's active", async () => {
    const actor = await makeActor();
    const category = await createCategory({ name: `QA Test Cat ${Date.now()}` }, actor.id);
    createdCategoryIds.push(category.id);

    const navCategories = await listStorefrontNavCategories();
    expect(navCategories.some((c) => c.id === category.id)).toBe(false);
  });

  it("a category explicitly opted in at creation time appears", async () => {
    const actor = await makeActor();
    const category = await createCategory(
      { name: `Vestidos ${Date.now()}`, showInStorefrontNav: true },
      actor.id,
    );
    createdCategoryIds.push(category.id);

    const navCategories = await listStorefrontNavCategories();
    expect(navCategories.some((c) => c.id === category.id)).toBe(true);
  });

  it("opting in after creation via updateCategory also works", async () => {
    const actor = await makeActor();
    const category = await createCategory({ name: `Remeras ${Date.now()}` }, actor.id);
    createdCategoryIds.push(category.id);

    let navCategories = await listStorefrontNavCategories();
    expect(navCategories.some((c) => c.id === category.id)).toBe(false);

    await updateCategory(category.id, { showInStorefrontNav: true }, actor.id);
    navCategories = await listStorefrontNavCategories();
    expect(navCategories.some((c) => c.id === category.id)).toBe(true);
  });

  it("an archived category never appears, even if opted in", async () => {
    const actor = await makeActor();
    const category = await createCategory(
      { name: `Archivada ${Date.now()}`, showInStorefrontNav: true },
      actor.id,
    );
    createdCategoryIds.push(category.id);
    await archiveCategory(category.id, actor.id);

    const navCategories = await listStorefrontNavCategories();
    expect(navCategories.some((c) => c.id === category.id)).toBe(false);
  });

  it("a non-top-level (child) category never appears, even if opted in", async () => {
    const actor = await makeActor();
    const parent = await createCategory({ name: `Ropa ${Date.now()}` }, actor.id);
    createdCategoryIds.push(parent.id);
    const child = await createCategory(
      { name: `Sub ${Date.now()}`, parentId: parent.id, showInStorefrontNav: true },
      actor.id,
    );
    createdCategoryIds.push(child.id);

    const navCategories = await listStorefrontNavCategories();
    expect(navCategories.some((c) => c.id === child.id)).toBe(false);
  });
});
