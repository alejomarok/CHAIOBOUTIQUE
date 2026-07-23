import "server-only";

import { prisma } from "@/lib/db";
import { PERMISSIONS, PERMISSION_LABELS_ES } from "@/modules/permissions/catalog";

import { ROLE_DEFINITIONS } from "./catalog";

// Shared by prisma/seed.ts (production-safe seed) and integration tests —
// pure upsert/additive logic, no admin-account side effects, so it's safe to
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
