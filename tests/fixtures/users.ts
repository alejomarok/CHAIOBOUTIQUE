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

export async function deleteTestUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.userRole.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}
