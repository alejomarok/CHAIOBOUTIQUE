"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { createSize, updateSize } from "@/modules/attributes/service";

const createSizeSchema = z.object({
  key: z.string().min(1, "La clave es obligatoria"),
  displayName: z.string().min(1, "El nombre es obligatorio"),
  group: z.string().optional(),
});

export async function createSizeAction(input: z.infer<typeof createSizeSchema>) {
  const actor = await requirePermission("attributes.manage");
  const data = createSizeSchema.parse(input);
  await createSize(
    { key: data.key, displayName: data.displayName, group: data.group ?? null },
    actor.id,
  );
  revalidatePath("/admin/sizes");
}

export async function toggleSizeActiveAction(input: { id: string; isActive: boolean }) {
  const actor = await requirePermission("attributes.manage");
  await updateSize(input.id, { isActive: input.isActive }, actor.id);
  revalidatePath("/admin/sizes");
}
