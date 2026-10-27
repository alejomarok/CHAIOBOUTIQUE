"use server";
import { after } from "next/server";
import { requestIp } from "@/lib/request-ip";
import { createRateLimiter } from "@/lib/rate-limit";
import { requestOrderRecovery, recoverOrderSchema } from "@/modules/orders/recovery-core";
import { processEmailOutbox } from "@/modules/email/outbox-core";

const ipLimiter = createRateLimiter(10, 60 * 60 * 1000);
const emailLimiter = createRateLimiter(5, 60 * 60 * 1000);
export async function recoverOrderAction(_previous: { message?: string }, form: FormData) {
  const message =
    "Si el email y el número coinciden con un pedido, te llegará un enlace privado. Si no lo recibís, revisá spam o contactanos por WhatsApp.";
  const parsed = recoverOrderSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success || form.get("website")) return { message };
  if (
    !(await ipLimiter.check(`recover-ip:${await requestIp()}`)).success ||
    !(await emailLimiter.check(`recover-email:${parsed.data.email}`)).success
  )
    return { message };
  await requestOrderRecovery(parsed.data);
  after(async () => {
    await processEmailOutbox(2);
  });
  return { message };
}
