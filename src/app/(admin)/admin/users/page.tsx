import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/modules/auth";
import { listRoles } from "@/modules/roles/service";
import { listUsers } from "@/modules/users/service";

import { CreateUserDialog } from "./create-user-dialog";
import { UserRowActions } from "./user-row-actions";

export const metadata = { title: "Usuarias" };

export default async function UsersPage() {
  const user = await requirePermission("users.view");
  const canManage = user.permissions.has("users.manage");

  const [users, roles] = await Promise.all([listUsers(), listRoles()]);
  const roleOptions = roles.map((role) => ({ id: role.id, name: role.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Usuarias</h1>
          <p className="text-muted-foreground text-sm">
            Personal con acceso al panel de administración y al punto de venta.
          </p>
        </div>
        {canManage && <CreateUserDialog roles={roleOptions} />}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Estado</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.userRoles.map((userRole) => (
                      <Badge key={userRole.id} variant="secondary">
                        {userRole.role.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "outline"}>
                    {row.isActive ? "Activa" : "Deshabilitada"}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell>
                    <UserRowActions
                      userId={row.id}
                      isActive={row.isActive}
                      assignedRoleIds={row.userRoles.map((userRole) => userRole.roleId)}
                      roles={roleOptions}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
