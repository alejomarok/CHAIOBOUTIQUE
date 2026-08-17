import { AdminRoot } from "@/components/layout/admin-root";
import { ADMIN_NAV_GROUPS } from "@/components/layout/admin-nav-items";
import { AdminShell } from "@/components/layout/admin-shell";
import { requirePermission } from "@/modules/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Coarse check only happened in proxy.ts (cookie presence). This is the
  // real authorization check — see modules/auth/require-permission.ts.
  // admin.access is a named portal-access capability, not an inferred "any
  // authenticated non-customer" check — every current staff role has it
  // (see modules/roles/catalog.ts), a CUSTOMER account never does.
  const user = await requirePermission("admin.access");

  // Same RBAC filtering as before, just per-group: an item without the
  // required permission is dropped, and a group left with zero items
  // (e.g. a role with no Inventario permissions at all) is dropped too —
  // never an empty section header. This only controls what's *offered* in
  // the UI; every page re-checks its own permission on the server
  // regardless (see requirePermission calls throughout /admin/*).
  const visibleGroups = ADMIN_NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => !item.permission || user.permissions.has(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <AdminRoot>
      <AdminShell groups={visibleGroups} user={{ name: user.name, email: user.email }}>
        {children}
      </AdminShell>
    </AdminRoot>
  );
}
