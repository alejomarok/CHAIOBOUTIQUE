// @vitest-environment node
import "./guard";

import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
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
    // Sourced from the same validated env config the production seed uses
    // (prisma/seed.ts) and the integration suite's own global reset
    // (tests/integration/reset-db.ts) — never a hardcoded literal, so this
    // test can never drift from what actually got seeded. This call is a
    // no-op in practice by the time this file's tests run (global-setup.ts
    // already seeded it via the same values, and seedStoreConfiguration's
    // upsert never overwrites an existing row — see roles/seed-core.ts) —
    // kept for this file's own standalone-run correctness regardless.
    await seedStoreConfiguration({
      name: env.STORE_NAME,
      currency: env.STORE_CURRENCY,
      locale: env.STORE_LOCALE,
      timezone: env.STORE_TIMEZONE,
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
    // Asserted against the same validated env config the seed itself reads
    // from (env.STORE_NAME), not a hardcoded literal — whatever STORE_NAME
    // your .env actually sets (including a deliberately distinguishable
    // test value) is what this checks the seed actually persisted.
    expect(rows[0].name).toBe(env.STORE_NAME);
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
