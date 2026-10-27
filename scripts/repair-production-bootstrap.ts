import "dotenv/config";
import { prisma } from "../src/lib/db-core";
import { PERMISSIONS } from "../src/modules/permissions/catalog";
import {
  seedPermissions,
  seedRolesAndAssignments,
  seedSystemAccount,
} from "../src/modules/roles/seed-core";
import { seedStoreBranches } from "../src/modules/store-branches/seed-core";

async function main() {
  const report = {
    permissionsPresent: await prisma.permission.count(),
    permissionsRequired: PERMISSIONS.length,
    systemAccountPresent: Boolean(
      await prisma.user.findFirst({ where: { isSystemAccount: true } }),
    ),
    embalsePresent: Boolean(await prisma.storeBranch.findUnique({ where: { code: "embalse" } })),
  };
  console.log(report);
  if (!process.argv.includes("--apply")) {
    console.log(
      "Read-only report. --apply adds only permission metadata, the non-login system account and the confirmed Embalse branch. No products, customer backfill, passwords or sizes are changed.",
    );
    return;
  }
  await seedPermissions();
  await seedRolesAndAssignments();
  await seedSystemAccount();
  await seedStoreBranches();
  console.log("Permission metadata, system account and branch setup completed.");
}
main()
  .catch(() => {
    console.error("Technical bootstrap failed; credentials omitted.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
