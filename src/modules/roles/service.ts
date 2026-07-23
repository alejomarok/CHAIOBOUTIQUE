import "server-only";

import { recordAuditLog } from "@/modules/audit";
import { prisma } from "@/lib/db";
import type { Permission } from "@/modules/permissions/catalog";

export async function listRoles() {
  return prisma.role.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { rolePermissions: true, userRoles: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getRoleWithPermissions(roleId: string) {
  return prisma.role.findUnique({
    where: { id: roleId },
    include: { rolePermissions: { include: { permission: true } } },
  });
}

export async function listPermissions() {
  return prisma.permission.findMany({ orderBy: { key: "asc" } });
}

export interface UserRolesAndPermissions {
  roles: string[];
  permissions: Set<Permission>;
}

// The actual RBAC evaluation: given a userId, what roles and permissions do
// they currently have. Deliberately independent of Better Auth/next/headers
// so it can be exercised directly in integration tests against a real
// database, not just through a full request. modules/auth/session.ts wraps
// this with session resolution.
export async function getUserPermissions(userId: string): Promise<UserRolesAndPermissions> {
  const userRoles = await prisma.userRole.findMany({
    where: { userId, role: { isActive: true, deletedAt: null } },
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  });

  const roles = new Set<string>();
  const permissions = new Set<Permission>();

  for (const userRole of userRoles) {
    roles.add(userRole.role.key);
    for (const rolePermission of userRole.role.rolePermissions) {
      permissions.add(rolePermission.permission.key as Permission);
    }
  }

  return { roles: [...roles], permissions };
}

// Replaces a role's entire permission set. Called from the roles admin page
// (server action already checked requirePermission("roles.manage")).
// isSystem only protects a role from deletion, not from having its
// permissions edited — an admin adjusting what MANAGER can do is expected.
export async function setRolePermissions(
  roleId: string,
  permissionKeys: Permission[],
  actorId: string,
): Promise<void> {
  const before = await getRoleWithPermissions(roleId);
  if (!before) throw new Error("Role not found");

  const permissions = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
    select: { id: true, key: true },
  });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
    }),
  ]);

  await recordAuditLog({
    userId: actorId,
    action: "role.permissions_updated",
    entityType: "Role",
    entityId: roleId,
    previousValue: { permissions: before.rolePermissions.map((rp) => rp.permission.key) },
    newValue: { permissions: permissions.map((p) => p.key) },
  });
}

export async function assignRoleToUser(
  userId: string,
  roleId: string,
  actorId: string,
): Promise<void> {
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    update: {},
    create: { userId, roleId, assignedBy: actorId },
  });

  const role = await prisma.role.findUnique({ where: { id: roleId } });

  await recordAuditLog({
    userId: actorId,
    action: "user.role_assigned",
    entityType: "User",
    entityId: userId,
    newValue: { roleKey: role?.key },
  });
}

export async function revokeRoleFromUser(
  userId: string,
  roleId: string,
  actorId: string,
): Promise<void> {
  await prisma.userRole.deleteMany({ where: { userId, roleId } });

  const role = await prisma.role.findUnique({ where: { id: roleId } });

  await recordAuditLog({
    userId: actorId,
    action: "user.role_revoked",
    entityType: "User",
    entityId: userId,
    previousValue: { roleKey: role?.key },
  });
}
