import { execFileSync } from "node:child_process";

import { prisma } from "@/lib/db-core";

import { assertSafeToResetTestDatabase, resetTestDatabase } from "../integration/reset-db";
import { createTestUser } from "../fixtures/users";
import { ADMIN_FIXTURE, CUSTOMER_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

// Everything here runs in Playwright's own plain-Node test-runner process
// (never inside the webServer's `next dev` child) — every import above is a
// "-core" (Node-safe, no "server-only") module for exactly that reason. See
// src/lib/db-core.ts and tests/fixtures/users.ts.
export default async function globalSetup() {
  // Fail closed before doing anything else — including running migrations —
  // unless DATABASE_URL unambiguously points at the local, disposable
  // Docker test database. Reuses the exact same check tests/integration's
  // suite already relies on; never a second, hand-rolled copy. Throws (and
  // aborts the whole run) rather than ever risking Supabase.
  assertSafeToResetTestDatabase();

  // Idempotent — applies whatever migration isn't yet present on the Docker
  // test database. DATABASE_URL/DIRECT_URL are already forced to
  // TEST_DATABASE_URL for this entire process by package.json's "test:e2e"
  // script (it wraps `playwright test` with scripts/with-test-db.mjs, the
  // same wrapper npm run test:integration/test:migrations use), so this
  // targets the Docker database, never Supabase.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  // Truncates every application table and reseeds permissions/roles/store
  // configuration — the exact same reset the integration suite uses (see
  // tests/integration/reset-db.ts), so there's one seed implementation, not
  // a second copy for e2e. Also re-asserts the safety guard above.
  await resetTestDatabase();

  await createTestUser(ADMIN_FIXTURE);
  await createTestUser(RESTRICTED_FIXTURE);
  await createTestUser(CUSTOMER_FIXTURE);

  // Sanity check, not a silent assumption: confirm the CUSTOMER fixture
  // really did come out of createTestUser's emailVerified handling verified
  // — a login test asserting "/catalog" would otherwise fail confusingly at
  // "/verify-email" instead.
  const customer = await prisma.user.findUniqueOrThrow({
    where: { email: CUSTOMER_FIXTURE.email },
  });
  if (!customer.emailVerified) {
    throw new Error(
      `E2E setup: ${CUSTOMER_FIXTURE.email} was not marked emailVerified as expected.`,
    );
  }
}
