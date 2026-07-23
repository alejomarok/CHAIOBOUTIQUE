import "server-only";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";
import { revokeUserSessions } from "@/modules/auth";
import { assignRoleToUser } from "@/modules/roles/service";

export async function listUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null },
    include: { userRoles: { include: { role: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getUserById(id: string) {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: { userRoles: { include: { role: true } } },
  });
}

export interface CreateStaffUserInput {
  name: string;
  email: string;
  password: string;
  roleId: string;
}

// Goes through Better Auth's own sign-up path so the password is hashed
// exactly as Better Auth expects (never hand-rolled), then assigns the
// chosen role. Mirrors how the production-safe seed creates the initial
// administrator — see prisma/seed.ts.
export async function createStaffUser(input: CreateStaffUserInput, actorId: string) {
  const result = await auth.api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
  });

  await assignRoleToUser(result.user.id, input.roleId, actorId);

  await recordAuditLog({
    userId: actorId,
    action: "user.created",
    entityType: "User",
    entityId: result.user.id,
    newValue: { name: input.name, email: input.email },
  });

  return result.user;
}

export async function disableUser(userId: string, actorId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false, disabledAt: new Date() },
  });
  await revokeUserSessions(userId);

  await recordAuditLog({
    userId: actorId,
    action: "user.disabled",
    entityType: "User",
    entityId: userId,
  });
}

export async function enableUser(userId: string, actorId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: true, disabledAt: null },
  });

  await recordAuditLog({
    userId: actorId,
    action: "user.enabled",
    entityType: "User",
    entityId: userId,
  });
}

export async function softDeleteUser(userId: string, actorId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false, deletedAt: new Date() },
  });
  await revokeUserSessions(userId);

  await recordAuditLog({
    userId: actorId,
    action: "user.soft_deleted",
    entityType: "User",
    entityId: userId,
  });
}

export async function revokeSessionsForUser(userId: string, actorId: string): Promise<void> {
  await revokeUserSessions(userId);

  await recordAuditLog({
    userId: actorId,
    action: "user.sessions_revoked",
    entityType: "User",
    entityId: userId,
  });
}
