import { KeyRound, LayoutDashboard, Settings, ShieldCheck, UserRound, Users } from "lucide-react";
import type { ComponentType } from "react";

import type { Permission } from "@/modules/permissions/catalog";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  permission?: Permission;
}

// Undefined permission = visible to any authenticated staff user (Dashboard,
// Profile). Every other item is filtered server-side in
// (admin)/admin/layout.tsx against the current user's actual permissions —
// this list only controls what's *offered* in the UI, not what's allowed;
// every page re-checks its own permission on the server regardless.
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard },
  { href: "/admin/users", label: "Usuarias", icon: Users, permission: "users.view" },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck, permission: "roles.manage" },
  { href: "/admin/permissions", label: "Permisos", icon: KeyRound, permission: "roles.manage" },
  {
    href: "/admin/settings",
    label: "Configuración",
    icon: Settings,
    permission: "settings.view",
  },
  { href: "/admin/profile", label: "Mi perfil", icon: UserRound },
];
