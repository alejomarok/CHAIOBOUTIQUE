// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { CategoryCycleError, createCategory, updateCategory } from "@/modules/categories/service";

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
