"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import {
  createSizeGroup,
  createSizeOption,
  deleteSizeGroup,
  updateSizeGroup,
  updateSizeOption,
} from "@/modules/attributes/service";

const createSizeGroupSchema = z.object({
  code: z.string().min(1, "El código es obligatorio"),
  name: z.string().min(1, "El nombre es obligatorio"),
  description: z.string().optional(),
});

export async function createSizeGroupAction(input: z.infer<typeof createSizeGroupSchema>) {
  const actor = await requirePermission("attributes.manage");
  const data = createSizeGroupSchema.parse(input);
  const sizeGroup = await createSizeGroup(
    { code: data.code, name: data.name, description: data.description || null },
    actor.id,
  );
  revalidatePath("/admin/size-groups");
  return { id: sizeGroup.id };
}

export async function deleteSizeGroupAction(input: { id: string }) {
  const actor = await requirePermission("attributes.manage");
  await deleteSizeGroup(input.id, actor.id);
  revalidatePath("/admin/size-groups");
}

export async function toggleSizeGroupActiveAction(input: { id: string; isActive: boolean }) {
  const actor = await requirePermission("attributes.manage");
  await updateSizeGroup(input.id, { isActive: input.isActive }, actor.id);
  revalidatePath("/admin/size-groups");
}

const createSizeOptionSchema = z.object({
  sizeGroupId: z.string().min(1),
  code: z.string().min(1, "El código es obligatorio"),
  label: z.string().min(1, "El nombre visible es obligatorio"),
  sortOrder: z.number().int().optional(),
});

export async function createSizeOptionAction(input: z.infer<typeof createSizeOptionSchema>) {
  const actor = await requirePermission("attributes.manage");
  const data = createSizeOptionSchema.parse(input);
  await createSizeOption(
    {
      sizeGroupId: data.sizeGroupId,
      code: data.code,
      label: data.label,
      sortOrder: data.sortOrder,
    },
    actor.id,
  );
  revalidatePath(`/admin/size-groups/${data.sizeGroupId}`);
}

export async function toggleSizeOptionActiveAction(input: {
  id: string;
  sizeGroupId: string;
  isActive: boolean;
}) {
  const actor = await requirePermission("attributes.manage");
  await updateSizeOption(input.id, { isActive: input.isActive }, actor.id);
  revalidatePath(`/admin/size-groups/${input.sizeGroupId}`);
}

const updateSizeOptionSchema = z.object({
  id: z.string().min(1),
  sizeGroupId: z.string().min(1),
  code: z.string().min(1, "El código es obligatorio"),
  label: z.string().min(1, "El nombre visible es obligatorio"),
  sortOrder: z.number().int(),
});

export async function updateSizeOptionAction(input: z.infer<typeof updateSizeOptionSchema>) {
  const actor = await requirePermission("attributes.manage");
  const data = updateSizeOptionSchema.parse(input);
  await updateSizeOption(
    data.id,
    { code: data.code, label: data.label, sortOrder: data.sortOrder },
    actor.id,
  );
  revalidatePath(`/admin/size-groups/${data.sizeGroupId}`);
}
