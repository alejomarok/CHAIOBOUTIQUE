"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { isPermission } from "@/modules/permissions/catalog";
import { setRolePermissions } from "@/modules/roles/service";

const updateRolePermissionsSchema = z.object({
  roleId: z.string().min(1),
  permissionKeys: z.array(z.string().refine(isPermission)),
});

export async function updateRolePermissionsAction(input: {
  roleId: string;
  permissionKeys: string[];
}) {
  const user = await requirePermission("roles.manage");
  const data = updateRolePermissionsSchema.parse(input);

  await setRolePermissions(data.roleId, data.permissionKeys, user.id);
  revalidatePath(`/admin/roles/${data.roleId}`);
  revalidatePath("/admin/roles");
}
