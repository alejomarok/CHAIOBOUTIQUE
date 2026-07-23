import "server-only";

import { forbidden, unauthorized } from "next/navigation";

import type { Permission } from "@/modules/permissions/catalog";

import { getCurrentUser, type CurrentUser } from "./session";

// Renders app/unauthorized.tsx with a real 401. Requires
// experimental.authInterrupts in next.config.ts (see that file for why).
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) unauthorized();
  return user;
}

// Renders app/forbidden.tsx with a real 403. This is the actual enforcement
// point for every protected page/action — middleware-level (proxy.ts)
// redirects are a coarse UX convenience only, never the authorization check.
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.permissions.has(permission)) forbidden();
  return user;
}

export async function requireAnyPermission(permissions: Permission[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!permissions.some((permission) => user.permissions.has(permission))) forbidden();
  return user;
}

export function hasPermission(user: CurrentUser, permission: Permission): boolean {
  return user.permissions.has(permission);
}
