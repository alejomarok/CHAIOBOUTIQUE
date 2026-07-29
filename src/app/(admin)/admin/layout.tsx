import { ADMIN_NAV_ITEMS } from "@/components/layout/admin-nav-items";
import { AdminShell } from "@/components/layout/admin-shell";
import { requirePermission } from "@/modules/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Coarse check only happened in proxy.ts (cookie presence). This is the
  // real authorization check — see modules/auth/require-permission.ts.
  // admin.access is a named portal-access capability, not an inferred "any
  // authenticated non-customer" check — every current staff role has it
  // (see modules/roles/catalog.ts), a CUSTOMER account never does.
  const user = await requirePermission("admin.access");

  const visibleItems = ADMIN_NAV_ITEMS.filter(
    (item) => !item.permission || user.permissions.has(item.permission),
  );

  return (
    <AdminShell items={visibleItems} user={{ name: user.name, email: user.email }}>
      {children}
    </AdminShell>
  );
}
