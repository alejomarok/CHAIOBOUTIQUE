// @vitest-environment node
import "./guard";

import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/modules/permissions/catalog";
import { ROLE_DEFINITIONS } from "@/modules/roles/catalog";
import {
  seedPermissions,
  seedRolesAndAssignments,
  seedStoreConfiguration,
} from "@/modules/roles/seed";

describe("production-safe seed (against TEST_DATABASE_URL)", () => {
  beforeAll(async () => {
    await seedPermissions();
    await seedRolesAndAssignments();
    await seedStoreConfiguration({
      name: "CHAIOBOUTIQUE",
      currency: "ARS",
      locale: "es-AR",
      timezone: "America/Argentina/Cordoba",
    });
  });

  it("creates every permission from the catalog", async () => {
    const permissions = await prisma.permission.findMany();
    const keys = permissions.map((p) => p.key).sort();
    expect(keys).toEqual([...PERMISSIONS].sort());
  });

  it("creates all 6 system roles, marked isSystem", async () => {
    const roles = await prisma.role.findMany();
    expect(roles).toHaveLength(6);
    expect(roles.every((role) => role.isSystem)).toBe(true);
  });

  it("assigns ADMIN every permission in the catalog", async () => {
    const admin = await prisma.role.findUniqueOrThrow({
      where: { key: "ADMIN" },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const keys = admin.rolePermissions.map((rp) => rp.permission.key).sort();
    expect(keys).toEqual([...PERMISSIONS].sort());
  });

  it("assigns CUSTOMER no permissions", async () => {
    const customer = await prisma.role.findUniqueOrThrow({
      where: { key: "CUSTOMER" },
      include: { rolePermissions: true },
    });
    expect(customer.rolePermissions).toHaveLength(0);
  });

  it("creates the base store configuration as a single row", async () => {
    const rows = await prisma.storeConfiguration.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("CHAIOBOUTIQUE");
  });

  it("is idempotent: running it twice does not duplicate roles or permissions", async () => {
    await seedPermissions();
    await seedRolesAndAssignments();

    const permissions = await prisma.permission.findMany();
    const roles = await prisma.role.findMany();
    expect(permissions).toHaveLength(PERMISSIONS.length);
    expect(roles).toHaveLength(ROLE_DEFINITIONS.length);
  });
});
