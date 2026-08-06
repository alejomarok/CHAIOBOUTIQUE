// Production-safe seed. Creates ONLY: the 6 system roles, the permission
// catalog, role-permission assignments, the base store configuration, and
// (only if both env vars are set) one initial administrator.
//
// No demo products/customers/test users of any kind — those live exclusively
// in tests/fixtures and are never reachable from this script. Safe to run
// more than once: roles/permissions are upserted, role-permission links are
// additive only (never deleted), so manual permission edits made later
// through the admin UI are never clobbered by a re-seed.
//
// Runs via `tsx`, outside the Next.js bundler — every import below resolves
// to a "-core" module (no "server-only" guard) so the import graph is plain
// Node.js, not Next.js. See src/lib/auth-core.ts, src/lib/db-core.ts,
// src/lib/env-core.ts, src/modules/roles/seed-core.ts, and ARCHITECTURE.md.
import "dotenv/config";

import { auth, REQUIRE_EMAIL_VERIFICATION } from "@/lib/auth-core";
import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import { printSizeSeedSummary, seedDefaultSizeGroups } from "@/modules/attributes/seed-core";
import { PERMISSIONS } from "@/modules/permissions/catalog";
import { ROLE_DEFINITIONS } from "@/modules/roles/catalog";
import {
  seedPermissions,
  seedRolesAndAssignments,
  seedStoreConfiguration,
} from "@/modules/roles/seed-core";

async function seedInitialAdmin() {
  if (!env.INITIAL_ADMIN_EMAIL || !env.INITIAL_ADMIN_PASSWORD || !env.INITIAL_ADMIN_NAME) {
    console.log(
      "INITIAL_ADMIN_NAME/EMAIL/PASSWORD not fully set — skipping initial administrator creation.",
    );
    return;
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });

  let user = await prisma.user.findUnique({ where: { email: env.INITIAL_ADMIN_EMAIL } });

  if (!user) {
    // Goes through Better Auth's own sign-up path so the password is hashed
    // exactly as Better Auth expects — never hand-rolled here.
    const result = await auth.api.signUpEmail({
      body: {
        name: env.INITIAL_ADMIN_NAME,
        email: env.INITIAL_ADMIN_EMAIL,
        password: env.INITIAL_ADMIN_PASSWORD,
      },
    });
    user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
    console.log(`Created initial administrator: ${env.INITIAL_ADMIN_EMAIL}`);
  } else {
    console.log("Initial administrator already exists — leaving password untouched.");
  }

  // Idempotent: upsert, not create — self-heals if a prior run created the
  // User row but crashed before this assignment landed. Only ever assigns
  // ADMIN here, regardless of what else the account might already have.
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });

  // The seeded administrator is bootstrapped directly, never through the
  // real email-verification link flow — so once verification is required to
  // sign in at all, they need to already be marked verified or they'd lock
  // themselves out. No-op today (REQUIRE_EMAIL_VERIFICATION is false), ready
  // for when it flips to true.
  if (REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    console.log("Marked initial administrator as email-verified (verification is required).");
  }
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

  const sizeSeedSummary = await seedDefaultSizeGroups();
  printSizeSeedSummary(sizeSeedSummary);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
