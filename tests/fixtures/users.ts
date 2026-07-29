import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assignRoleToUser } from "@/modules/roles/service";

// Test-only fixtures — never imported from prisma/seed.ts. Creates real,
// login-capable accounts through Better Auth's own sign-up path (so
// passwords are hashed exactly as Better Auth expects), then optionally
// assigns a system role by key.
export async function createTestUser(input: {
  name: string;
  email: string;
  password: string;
  roleKey?: string;
}) {
  const result = await auth.api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
  });

  if (input.roleKey) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: input.roleKey } });
    await assignRoleToUser(result.user.id, role.id, result.user.id);
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
