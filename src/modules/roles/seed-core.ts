import { prisma } from "@/lib/db-core";
import { PERMISSIONS, PERMISSION_LABELS_ES } from "@/modules/permissions/catalog";

import { ROLE_DEFINITIONS } from "./catalog";

// Node-safe core: no "server-only" import, and imports db-core.ts (not
// db.ts) so this stays importable from prisma/seed.ts via `tsx` — see
// src/modules/roles/seed.ts and ARCHITECTURE.md. Also imported directly by
// integration tests (vitest aliases "server-only" to a no-op, so those could
// import the src/modules/roles/seed.ts wrapper too, but importing the core
// here keeps one obviously-CLI-safe entry point for both callers).
//
// Pure upsert/additive logic, no admin-account side effects, so it's safe to
// call repeatedly and safe to exercise directly against TEST_DATABASE_URL.
export async function seedPermissions(): Promise<void> {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { description: PERMISSION_LABELS_ES[key] },
      create: { key, description: PERMISSION_LABELS_ES[key] },
    });
  }
}

export async function seedRolesAndAssignments(): Promise<void> {
  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: { name: definition.nameEs, description: definition.descriptionEs },
      create: {
        key: definition.key,
        name: definition.nameEs,
        description: definition.descriptionEs,
        isSystem: true,
      },
    });

    if (definition.permissions.length === 0) continue;

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...definition.permissions] } },
      select: { id: true },
    });

    // Additive only (skipDuplicates, no deleteMany): a re-seed never
    // clobbers permission edits made later through the admin UI.
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }
}

export async function seedStoreConfiguration(input: {
  name: string;
  currency: string;
  locale: string;
  timezone: string;
}): Promise<void> {
  await prisma.storeConfiguration.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main", ...input },
  });
}
