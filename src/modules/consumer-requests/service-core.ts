import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import { enqueueEmail } from "@/modules/email/outbox-core";
import { recordAuditLog } from "@/modules/audit/index-core";

export const consumerRequestSchema = z.object({
  requestId: z.uuid(),
  kind: z.enum(["WITHDRAWAL", "EXCHANGE", "PRIVACY"]),
  fullName: z.string().trim().min(2, "Ingresá tu nombre.").max(150),
  email: z
    .email("Ingresá un email válido.")
    .max(254)
    .transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(40).optional(),
  orderCode: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000).optional(),
});

export async function createConsumerRequest(input: z.infer<typeof consumerRequestSchema>) {
  const data = consumerRequestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.requestId}, 0))`;
    const existing = await tx.consumerRequest.findUnique({ where: { id: data.requestId } });
    if (existing) {
      if (existing.email !== data.email)
        throw new Error("No pudimos registrar la solicitud. Intentá nuevamente.");
      return existing;
    }
    const code = `SOL-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const request = await tx.consumerRequest.create({
      data: {
        id: data.requestId,
        code,
        kind: data.kind,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone || null,
        orderCode: data.orderCode || null,
        message: data.message || null,
      },
    });
    await enqueueEmail(tx, {
      eventKey: `consumer-request:${request.id}:receipt`,
      recipient: data.email,
      payload: {
        subject: `Recibimos tu solicitud ${code} — CHAIOBOUTIQUE`,
        text: `Tu solicitud fue registrada con el código ${code}. Conservá esta constancia. Nos vamos a comunicar para coordinar los pasos correspondientes. No necesitás crear una cuenta.\n\nConsultas: WhatsApp +54 9 3571 31-9469.`,
      },
    });
    const config = await tx.storeConfiguration.findUnique({
      where: { id: "main" },
      select: { publicEmail: true },
    });
    if (config?.publicEmail)
      await enqueueEmail(tx, {
        eventKey: `consumer-request:${request.id}:merchant`,
        recipient: config.publicEmail,
        payload: {
          subject: `Nueva solicitud ${code}`,
          text: `Revisá la solicitud en ${env.NEXT_PUBLIC_APP_URL}/admin/requests.`,
        },
      });
    return request;
  });
}

export async function updateConsumerRequest(
  input: { id: string; status: "PROCESSING" | "RESOLVED" | "REJECTED"; resolution: string },
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM consumer_request WHERE id = ${input.id} FOR UPDATE`;
    const existing = await tx.consumerRequest.findUniqueOrThrow({ where: { id: input.id } });
    if (["RESOLVED", "REJECTED"].includes(existing.status))
      throw new Error("La solicitud ya fue cerrada.");
    const done = input.status !== "PROCESSING";
    if (done && !input.resolution.trim())
      throw new Error("Escribí la respuesta para la persona solicitante.");
    const updated = await tx.consumerRequest.update({
      where: { id: input.id },
      data: {
        status: input.status,
        resolution: input.resolution.trim() || null,
        resolvedAt: done ? new Date() : null,
        resolvedById: actorId,
      },
    });
    await recordAuditLog(
      {
        userId: actorId,
        action: "consumer_request.updated",
        entityType: "ConsumerRequest",
        entityId: existing.id,
        previousValue: { status: existing.status },
        newValue: { status: input.status },
      },
      tx,
    );
    if (done)
      await enqueueEmail(tx, {
        eventKey: `consumer-request:${existing.id}:resolution`,
        recipient: existing.email,
        payload: {
          subject: `Respuesta a tu solicitud ${existing.code} — CHAIOBOUTIQUE`,
          text: `Solicitud ${existing.code}\n\n${input.resolution.trim()}\n\nConsultas: WhatsApp +54 9 3571 31-9469.`,
        },
      });
    return updated;
  });
}
