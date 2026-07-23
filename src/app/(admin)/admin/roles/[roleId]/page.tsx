import { notFound } from "next/navigation";

import { requirePermission } from "@/modules/auth";
import type { Permission } from "@/modules/permissions/catalog";
import { getRoleWithPermissions } from "@/modules/roles/service";

import { RolePermissionsEditor } from "./role-permissions-editor";

export const metadata = { title: "Detalle de rol" };

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  await requirePermission("roles.manage");
  const { roleId } = await params;

  const role = await getRoleWithPermissions(roleId);
  if (!role) notFound();

  const currentPermissions = role.rolePermissions.map((rp) => rp.permission.key as Permission);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{role.name}</h1>
        <p className="text-muted-foreground text-sm">{role.description}</p>
      </div>
      <RolePermissionsEditor
        roleId={role.id}
        initialPermissions={currentPermissions}
        readOnly={false}
      />
    </div>
  );
}
