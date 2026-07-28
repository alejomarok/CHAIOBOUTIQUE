"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { createColor, updateColor } from "@/modules/attributes/service";

const createColorSchema = z.object({
  key: z.string().min(1, "La clave es obligatoria"),
  displayName: z.string().min(1, "El nombre es obligatorio"),
  hexPrimary: z.string().optional(),
});

export async function createColorAction(input: z.infer<typeof createColorSchema>) {
  const actor = await requirePermission("attributes.manage");
  const data = createColorSchema.parse(input);
  await createColor(
    { key: data.key, displayName: data.displayName, hexPrimary: data.hexPrimary ?? null },
    actor.id,
  );
  revalidatePath("/admin/colors");
}

export async function toggleColorActiveAction(input: { id: string; isActive: boolean }) {
  const actor = await requirePermission("attributes.manage");
  await updateColor(input.id, { isActive: input.isActive }, actor.id);
  revalidatePath("/admin/colors");
}
