import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listRoles } from "@/modules/roles/service";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  await requirePermission("roles.manage");
  const roles = await listRoles();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Roles</h1>
        <p className="text-muted-foreground text-sm">
          Los roles del sistema no se pueden eliminar. Sus permisos sí se pueden ajustar.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <Link key={role.id} href={`/admin/roles/${role.id}`}>
            <Card className="hover:ring-primary/40 transition-shadow hover:ring-2">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{role.name}</CardTitle>
                  {role.isSystem && <Badge variant="secondary">Sistema</Badge>}
                </div>
                <CardDescription>{role.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground flex gap-4 text-sm">
                <span>{role._count.rolePermissions} permisos</span>
                <span>{role._count.userRoles} usuarias</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
