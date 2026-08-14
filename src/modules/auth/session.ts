import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { timed } from "@/lib/timing";
import type { Permission } from "@/modules/permissions/catalog";
import { getUserPermissions } from "@/modules/roles/service";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
  permissions: Set<Permission>;
}

// Cached per request (React cache()): several requirePermission()/
// getCurrentUser() calls during the same render hit the database once.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await timed("auth.getSession", async () => {
    const requestHeaders = await headers();
    return auth.api.getSession({ headers: requestHeaders });
  });

  if (!session) return null;

  const { user } = session;

  // Enforcement point for disabled/soft-deleted accounts: Better Auth only
  // proves who authenticated, not whether they're still allowed in. A valid
  // session row is not sufficient — see ARCHITECTURE.md.
  const isActive = (user as unknown as { isActive?: boolean }).isActive ?? true;
  const deletedAt = (user as unknown as { deletedAt?: Date | string | null }).deletedAt ?? null;
  if (!isActive || deletedAt) return null;

  const { roles, permissions } = await timed("getUserPermissions", () =>
    getUserPermissions(user.id),
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    roles,
    permissions,
  };
});
