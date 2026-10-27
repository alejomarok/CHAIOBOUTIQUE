"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/modules/auth";
import { updateConsumerRequest } from "@/modules/consumer-requests/service-core";
import { processEmailOutbox } from "@/modules/email/outbox-core";

export async function manageConsumerRequestAction(
  _previous: { error?: string; success?: boolean },
  form: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const actor = await requirePermission("orders.manage");
  const parsed = z
    .object({
      id: z.string().min(1),
      status: z.enum(["PROCESSING", "RESOLVED", "REJECTED"]),
      resolution: z.string().trim().max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá los datos de la respuesta." };
  try {
    await updateConsumerRequest(parsed.data, actor.id);
    revalidatePath("/admin/requests");
    after(async () => {
      await processEmailOutbox(2);
    });
    return { success: true };
  } catch {
    return { error: "No pudimos actualizar la solicitud. Revisá su estado e intentá nuevamente." };
  }
}
