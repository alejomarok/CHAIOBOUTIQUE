"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { assignRoleToUser, revokeRoleFromUser } from "@/modules/roles/service";
import {
  createStaffUser,
  disableUser,
  enableUser,
  revokeSessionsForUser,
} from "@/modules/users/service";

const createStaffUserSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  email: z.email("Ingresá un email válido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  roleId: z.string().min(1, "Elegí un rol"),
});

export async function createStaffUserAction(input: z.infer<typeof createStaffUserSchema>) {
  const actor = await requirePermission("users.manage");
  const data = createStaffUserSchema.parse(input);

  await createStaffUser(data, actor.id);
  revalidatePath("/admin/users");
}

const userIdSchema = z.object({ userId: z.string().min(1) });

export async function disableUserAction(input: { userId: string }) {
  const actor = await requirePermission("users.manage");
  const { userId } = userIdSchema.parse(input);
  await disableUser(userId, actor.id);
  revalidatePath("/admin/users");
}

export async function enableUserAction(input: { userId: string }) {
  const actor = await requirePermission("users.manage");
  const { userId } = userIdSchema.parse(input);
  await enableUser(userId, actor.id);
  revalidatePath("/admin/users");
}

export async function revokeSessionsAction(input: { userId: string }) {
  const actor = await requirePermission("users.manage");
  const { userId } = userIdSchema.parse(input);
  await revokeSessionsForUser(userId, actor.id);
  revalidatePath("/admin/users");
}

const assignRoleSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
});

export async function assignRoleAction(input: { userId: string; roleId: string }) {
  const actor = await requirePermission("users.manage");
  const data = assignRoleSchema.parse(input);
  await assignRoleToUser(data.userId, data.roleId, actor.id);
  revalidatePath("/admin/users");
}

export async function revokeRoleAction(input: { userId: string; roleId: string }) {
  const actor = await requirePermission("users.manage");
  const data = assignRoleSchema.parse(input);
  await revokeRoleFromUser(data.userId, data.roleId, actor.id);
  revalidatePath("/admin/users");
}
