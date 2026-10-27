import { z } from "zod";
import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import { openSecret } from "@/lib/secret-box";
import { enqueueEmail } from "@/modules/email/outbox-core";

export const recoverOrderSchema = z.object({
  requestId: z.uuid(),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  orderCode: z.string().trim().min(1).max(80),
});

// Never return a lookup result or access token to the requester.
export async function requestOrderRecovery(input: z.infer<typeof recoverOrderSchema>) {
  const data = recoverOrderSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { code: data.orderCode, contactEmailSnapshot: data.email },
    });
    if (!order?.accessTokenEncrypted) return;
    const token = openSecret(order.accessTokenEncrypted, "order-access");
    await enqueueEmail(tx, {
      orderId: order.id,
      eventKey: `order-recovery:${order.id}:${data.requestId}`,
      recipient: order.contactEmailSnapshot,
      payload: {
        subject: `Tu pedido ${order.code} — CHAIOBOUTIQUE`,
        text: `Podés consultar tu pedido en este enlace privado:\n${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/order/${encodeURIComponent(token)}\n\nNo lo compartas. Si no pediste este correo, podés ignorarlo. No se modificó tu pedido.`,
      },
    });
  });
}
