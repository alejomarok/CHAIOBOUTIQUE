import "../integration/guard";

import { seedPermissions, seedRolesAndAssignments } from "@/modules/roles/seed";
import { createTestUser } from "../fixtures/users";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

export default async function globalSetup() {
  await seedPermissions();
  await seedRolesAndAssignments();
  await createTestUser(ADMIN_FIXTURE);
  await createTestUser(RESTRICTED_FIXTURE);
}
