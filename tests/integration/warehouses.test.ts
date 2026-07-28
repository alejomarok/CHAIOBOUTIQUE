// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createWarehouse, setDefaultWarehouse } from "@/modules/warehouses/service";

describe("warehouses — exactly one default (real DB)", () => {
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

  it("switching the default unsets the previous one", async () => {
    const actor = await createTestUser({
      name: "Warehouse Actor",
      email: `wh-actor-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);

    const a = await createWarehouse({ code: `DEF-A-${Date.now()}`, name: "A" }, actor.id);
    cleanup.push(() => prisma.warehouse.delete({ where: { id: a.id } }));
    const b = await createWarehouse({ code: `DEF-B-${Date.now()}`, name: "B" }, actor.id);
    cleanup.push(() => prisma.warehouse.delete({ where: { id: b.id } }));

    await setDefaultWarehouse(a.id, actor.id);
    await setDefaultWarehouse(b.id, actor.id);

    const [refreshedA, refreshedB] = await Promise.all([
      prisma.warehouse.findUniqueOrThrow({ where: { id: a.id } }),
      prisma.warehouse.findUniqueOrThrow({ where: { id: b.id } }),
    ]);

    expect(refreshedA.isDefault).toBe(false);
    expect(refreshedB.isDefault).toBe(true);

    const defaultCount = await prisma.warehouse.count({ where: { isDefault: true } });
    expect(defaultCount).toBe(1);
  });
});
