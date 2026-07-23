// @vitest-environment node
import "./guard";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestUser, deleteTestUser } from "../fixtures/users";
import { prisma } from "@/lib/db";
import { ROLE_DEFINITIONS } from "@/modules/roles/catalog";
import { getUserPermissions } from "@/modules/roles/service";
import { seedPermissions, seedRolesAndAssignments } from "@/modules/roles/seed";

const warehousePermissions = ROLE_DEFINITIONS.find((role) => role.key === "WAREHOUSE")!.permissions;

describe("RBAC permission evaluation (real DB, no mocks)", () => {
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await seedPermissions();
    await seedRolesAndAssignments();
  });

  afterEach(async () => {
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  it("a user with no roles has no permissions", async () => {
    const user = await createTestUser({
      name: "Sin Rol",
      email: `sin-rol-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(user.id);

    const result = await getUserPermissions(user.id);
    expect(result.roles).toHaveLength(0);
    expect(result.permissions.size).toBe(0);
  });

  it("a WAREHOUSE user gets exactly the WAREHOUSE permission set", async () => {
    const user = await createTestUser({
      name: "Depósito Test",
      email: `deposito-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
      roleKey: "WAREHOUSE",
    });
    createdUserIds.push(user.id);

    const result = await getUserPermissions(user.id);
    expect(result.roles).toEqual(["WAREHOUSE"]);
    expect([...result.permissions].sort()).toEqual([...warehousePermissions].sort());
    // The explicit, spec-mandated exclusion — this is the assertion that
    // actually matters for authorization correctness.
    expect(result.permissions.has("reports.view_profit")).toBe(false);
    expect(result.permissions.has("products.view_cost")).toBe(false);
  });

  it("a user with two roles gets the union of both roles' permissions", async () => {
    const user = await createTestUser({
      name: "Doble Rol",
      email: `doble-rol-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
      roleKey: "WAREHOUSE",
    });
    createdUserIds.push(user.id);

    const accountantRole = await prisma.role.findUniqueOrThrow({ where: { key: "ACCOUNTANT" } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: accountantRole.id } });

    const result = await getUserPermissions(user.id);
    expect(result.roles.sort()).toEqual(["ACCOUNTANT", "WAREHOUSE"]);
    // WAREHOUSE alone doesn't grant this; ACCOUNTANT does — proves the union,
    // not just the last-assigned role, is what's evaluated.
    expect(result.permissions.has("reports.view_profit")).toBe(true);
    // WAREHOUSE-only permission still present.
    expect(result.permissions.has("stock.adjust")).toBe(true);
  });
});
