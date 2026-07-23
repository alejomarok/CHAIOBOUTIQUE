import "server-only";

import { prisma } from "@/lib/db";

// Better Auth's database sessions are plain Postgres rows the adapter owns —
// deleting them invalidates the session on the user's next request without
// needing an extra plugin. Called from: disabling a user, soft-deleting a
// user, completing a password reset, and an explicit admin "revoke sessions"
// action. See ARCHITECTURE.md.
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
