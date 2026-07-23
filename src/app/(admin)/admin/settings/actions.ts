"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/modules/auth";
import { updateStoreConfiguration } from "@/modules/store-settings/service";

const updateStoreSettingsSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  currency: z.string().min(1).max(10),
  locale: z.string().min(1),
  timezone: z.string().min(1),
});

export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;

export async function updateStoreSettingsAction(input: UpdateStoreSettingsInput) {
  // Never trust the client: re-validate and re-authorize here even though
  // the form only renders for users the page already gated.
  const user = await requirePermission("settings.manage");
  const data = updateStoreSettingsSchema.parse(input);

  await updateStoreConfiguration(data, user.id);
  revalidatePath("/admin/settings");
}
