// @vitest-environment node
import "./guard";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestUser, deleteTestUser } from "../fixtures/users";
import { prisma } from "@/lib/db";
import {
  assignRoleToUser,
  getRoleWithPermissions,
  revokeRoleFromUser,
  setRolePermissions,
} from "@/modules/roles/service";
import { seedPermissions, seedRolesAndAssignments } from "@/modules/roles/seed";

describe("roles service — mutations are audited", () => {
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

  it("assigning a role creates a resolvable user_role row and an audit log entry", async () => {
    const user = await createTestUser({
      name: "Assign Test",
      email: `assign-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(user.id);

    const role = await prisma.role.findUniqueOrThrow({ where: { key: "SALES_REPRESENTATIVE" } });
    await assignRoleToUser(user.id, role.id, user.id);

    const userRole = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
    });
    expect(userRole).not.toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: "user.role_assigned", entityId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.newValue).toMatchObject({ roleKey: "SALES_REPRESENTATIVE" });
  });

  it("revoking a role removes the user_role row and logs it", async () => {
    const user = await createTestUser({
      name: "Revoke Test",
      email: `revoke-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
      roleKey: "SALES_REPRESENTATIVE",
    });
    createdUserIds.push(user.id);

    const role = await prisma.role.findUniqueOrThrow({ where: { key: "SALES_REPRESENTATIVE" } });
    await revokeRoleFromUser(user.id, role.id, user.id);

    const userRole = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
    });
    expect(userRole).toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: "user.role_revoked", entityId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("setRolePermissions replaces a role's permission set inside a transaction", async () => {
    const user = await createTestUser({
      name: "Actor Test",
      email: `actor-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(user.id);

    const role = await prisma.role.findUniqueOrThrow({ where: { key: "WAREHOUSE" } });

    await setRolePermissions(role.id, ["stock.view"], user.id);

    const updated = await getRoleWithPermissions(role.id);
    const keys = updated?.rolePermissions.map((rp) => rp.permission.key);
    expect(keys).toEqual(["stock.view"]);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: "role.permissions_updated", entityId: role.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEntry).not.toBeNull();

    // Restore the WAREHOUSE role's real permission set so this test doesn't
    // leave the shared test database in a state other tests don't expect.
    const { ROLE_DEFINITIONS } = await import("@/modules/roles/catalog");
    const warehouseDefinition = ROLE_DEFINITIONS.find((r) => r.key === "WAREHOUSE")!;
    await setRolePermissions(role.id, [...warehouseDefinition.permissions], user.id);
  });
});
