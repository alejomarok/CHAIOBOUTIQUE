"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth";
import { retryFailedEmails, processEmailOutbox } from "@/modules/email/outbox-core";
import { recordAuditLog } from "@/modules/audit/index-core";

export async function retryNotificationsAction() {
  const actor = await requirePermission("settings.manage");
  const result = await retryFailedEmails();
  await recordAuditLog({
    userId: actor.id,
    action: "email.failed_retried",
    entityType: "EmailOutbox",
    entityId: "queue",
    newValue: { count: result.count },
  });
  after(async () => {
    await processEmailOutbox(4);
  });
  revalidatePath("/admin/settings/production");
}
