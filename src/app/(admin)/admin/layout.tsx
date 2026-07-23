import { ADMIN_NAV_ITEMS } from "@/components/layout/admin-nav-items";
import { AdminShell } from "@/components/layout/admin-shell";
import { requireUser } from "@/modules/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Coarse check only happened in proxy.ts (cookie presence). This is the
  // real authentication check — see modules/auth/require-permission.ts.
  const user = await requireUser();

  const visibleItems = ADMIN_NAV_ITEMS.filter(
    (item) => !item.permission || user.permissions.has(item.permission),
  );

  return (
    <AdminShell items={visibleItems} user={{ name: user.name, email: user.email }}>
      {children}
    </AdminShell>
  );
}
