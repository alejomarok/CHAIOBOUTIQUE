import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/modules/auth";
import { PERMISSIONS, PERMISSION_LABELS_ES } from "@/modules/permissions/catalog";

export const metadata = { title: "Permisos" };

// Read-only catalog. There's no dedicated "permissions.view" key — this page
// is gated by roles.manage since permissions only matter in the context of
// what's assigned to a role (edited from /admin/roles/[roleId]).
export default async function PermissionsPage() {
  await requirePermission("roles.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Permisos</h1>
        <p className="text-muted-foreground text-sm">
          Catálogo de permisos del sistema. Se asignan desde cada rol en{" "}
          <span className="font-medium">Roles</span>.
        </p>
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Clave</TableHead>
              <TableHead>Descripción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERMISSIONS.map((key) => (
              <TableRow key={key}>
                <TableCell className="font-mono text-xs">{key}</TableCell>
                <TableCell>{PERMISSION_LABELS_ES[key]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
