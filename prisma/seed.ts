// Production-safe seed. Creates ONLY: the 6 system roles, the permission
// catalog, role-permission assignments, the base store configuration, and
// (only if both env vars are set) one initial administrator.
//
// No demo products/customers/test users of any kind — those live exclusively
// in tests/fixtures and are never reachable from this script. Safe to run
// more than once: roles/permissions are upserted, role-permission links are
// additive only (never deleted), so manual permission edits made later
// through the admin UI are never clobbered by a re-seed.
import "dotenv/config";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { PERMISSIONS } from "@/modules/permissions/catalog";
import { ROLE_DEFINITIONS } from "@/modules/roles/catalog";
import {
  seedPermissions,
  seedRolesAndAssignments,
  seedStoreConfiguration,
} from "@/modules/roles/seed";

async function seedInitialAdmin() {
  if (!env.INITIAL_ADMIN_EMAIL || !env.INITIAL_ADMIN_PASSWORD || !env.INITIAL_ADMIN_NAME) {
    console.log(
      "INITIAL_ADMIN_NAME/EMAIL/PASSWORD not fully set — skipping initial administrator creation.",
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: env.INITIAL_ADMIN_EMAIL } });
  if (existing) {
    console.log("Initial administrator already exists — skipping.");
    return;
  }

  // Goes through Better Auth's own sign-up path so the password is hashed
  // exactly as Better Auth expects — never hand-rolled here.
  const result = await auth.api.signUpEmail({
    body: {
      name: env.INITIAL_ADMIN_NAME,
      email: env.INITIAL_ADMIN_EMAIL,
      password: env.INITIAL_ADMIN_PASSWORD,
    },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });

  await prisma.userRole.create({
    data: { userId: result.user.id, roleId: adminRole.id },
  });

  console.log(`Created initial administrator: ${env.INITIAL_ADMIN_EMAIL}`);
}

async function main() {
  await seedPermissions();
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  await seedRolesAndAssignments();
  console.log(`Seeded ${ROLE_DEFINITIONS.length} roles and their permission assignments.`);

  await seedStoreConfiguration({
    name: env.STORE_NAME,
    currency: env.STORE_CURRENCY,
    locale: env.STORE_LOCALE,
    timezone: env.STORE_TIMEZONE,
  });
  console.log("Seeded base store configuration.");

  await seedInitialAdmin();
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
