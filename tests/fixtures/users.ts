import { auth } from "@/lib/auth-core";
import { prisma } from "@/lib/db-core";
import { assignRoleToUser } from "@/modules/roles/service-core";

// Test-only fixtures — never imported from prisma/seed.ts. Creates real,
// login-capable accounts through Better Auth's own sign-up path (so
// passwords are hashed exactly as Better Auth expects), then optionally
// assigns a system role by key.
//
// Imports the "-core" (Node-safe, no "server-only") variants of auth/db/
// roles-service deliberately, not the "server-only"-guarded wrappers this
// application code otherwise uses — this file is imported directly by both
// Vitest integration tests (which alias "server-only" to a no-op — see
// vitest.integration.config.ts) AND Playwright's plain-Node test-runner
// process (tests/e2e/*.spec.ts, global-setup.ts — which gets no such
// alias). Importing the core modules makes this one implementation work
// unmodified in both contexts, rather than needing two fixture files.
export async function createTestUser(input: {
  name: string;
  email: string;
  password: string;
  roleKey?: string;
  emailVerified?: boolean;
}) {
  const result = await auth.api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
  });

  if (input.roleKey) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: input.roleKey } });
    await assignRoleToUser(result.user.id, role.id, result.user.id);
  }

  if (input.emailVerified) {
    await prisma.user.update({ where: { id: result.user.id }, data: { emailVerified: true } });
  }

  return result.user;
}

// Deliberately does NOT delete the User row itself: audit_log.userId
// references it with onDelete: SetNull, and audit_log has a real,
// DB-level BEFORE UPDATE OR DELETE append-only trigger — that SetNull
// cascade is an UPDATE, which the trigger correctly rejects. Almost every
// service call in this codebase self-audits, so in practice any test user
// that exercised real behavior is unrepairable to delete this way. Session/
// account/role-assignment rows have no such constraint and are still
// cleaned up per-test; the User row itself is left for the isolated test
// database's full reset (see tests/integration/reset-db.ts, run once before
// the whole suite) to clear between `npm run test:integration` runs.
export async function deleteTestUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.userRole.deleteMany({ where: { userId } });
}
