import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { getEmailProvider } from "./delivery-core";
import {
  ORDER_STATUS_LABELS_ES,
  ORDER_PAYMENT_STATUS_LABELS_ES,
} from "@/modules/orders/order-labels";

const payloadSchema = z.object({ subject: z.string().max(200), text: z.string().max(30_000) });
type MailPayload = z.infer<typeof payloadSchema>;
type MailSender = (input: MailPayload & { to: string; messageId: string }) => Promise<void>;
let testSender: MailSender | null = null;

export function setOutboxSenderForTesting(sender: MailSender | null) {
  if (env.NODE_ENV === "production") throw new Error("Test sender forbidden in production");
  testSender = sender;
}

export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  input: {
    eventKey: string;
    recipient: string;
    payload: MailPayload;
    orderId?: string;
  },
) {
  const recipient = z.email().parse(input.recipient);
  const payload = payloadSchema.parse(input.payload);
  await tx.emailOutbox.upsert({
    where: { eventKey: input.eventKey },
    update: {},
    create: {
      eventKey: input.eventKey,
      recipient,
      orderId: input.orderId,
      encryptedPayload: sealSecret(JSON.stringify(payload), "email-outbox"),
    },
  });
}

export async function enqueueOrderEmails(
  tx: Prisma.TransactionClient,
  orderId: string,
  event: "created" | "paid" | "updated" | "adjusted",
  revision?: string,
) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const config = await tx.storeConfiguration.findUnique({ where: { id: "main" } });
  const token = order.accessTokenEncrypted
    ? openSecret(order.accessTokenEncrypted, "order-access")
    : null;
  const link = token
    ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/order/${encodeURIComponent(token)}`
    : null;
  const titles = {
    created: "Recibimos tu pedido",
    paid: "Confirmamos tu pago",
    updated: "Tu pedido tiene novedades",
    adjusted: "Actualización del pago de tu pedido",
  };
  const amount = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: order.currency,
  }).format(Number(order.totalAmount) / 100);
  const text = [
    `Hola ${order.contactNameSnapshot}.`,
    `${titles[event]} ${order.code} en ${config?.name ?? env.STORE_NAME}.`,
    `Importe del pedido: ${amount}.`,
    `Estado del pedido: ${ORDER_STATUS_LABELS_ES[order.status]}. Pago: ${ORDER_PAYMENT_STATUS_LABELS_ES[order.paymentStatus]}.`,
    event === "created"
      ? "El pedido queda reservado mientras completás el pago dentro del plazo informado. Este mensaje no acredita un cobro."
      : "",
    order.trackingCarrier ? `Transportista: ${order.trackingCarrier}.` : "",
    order.trackingNumber ? `Seguimiento: ${order.trackingNumber}.` : "",
    order.trackingUrl ?? "",
    link ? `Consultá el estado y los detalles: ${link}` : "",
    "El enlace es privado: conservá este correo y no lo compartas.",
    config?.whatsappPhone ? `Consultas por WhatsApp: ${config.whatsappPhone}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const suffix = revision ?? event;
  await enqueueEmail(tx, {
    eventKey: `order:${orderId}:${event}:${suffix}:customer`,
    orderId,
    recipient: order.contactEmailSnapshot,
    payload: {
      subject: `${titles[event]} ${order.code} — ${config?.name ?? env.STORE_NAME}`,
      text,
    },
  });
  if (config?.publicEmail)
    await enqueueEmail(tx, {
      eventKey: `order:${orderId}:${event}:${suffix}:merchant`,
      orderId,
      recipient: config.publicEmail,
      payload: {
        subject: `${titles[event]} ${order.code}`,
        text: `Pedido ${order.code}. ${titles[event]}.\n\nRevisalo en ${env.NEXT_PUBLIC_APP_URL}/admin/orders/${orderId}.`,
      },
    });
}

async function sendMail(input: MailPayload & { to: string; messageId: string }) {
  if (testSender) return testSender(input);
  await getEmailProvider().send(input);
}

export async function processEmailOutbox(limit = 10) {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < Math.min(limit, 25); i++) {
    const lease = new Date(Date.now() + 120_000);
    const rows = await prisma.$queryRaw<
      Array<{ id: string; recipient: string; encryptedPayload: string; attempts: number }>
    >`
      UPDATE email_outbox SET status = 'PROCESSING', "lockedUntil" = ${lease}, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM email_outbox
        WHERE (status = 'PENDING' AND "availableAt" <= clock_timestamp())
           OR (status = 'PROCESSING' AND "lockedUntil" < clock_timestamp())
        ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING id, recipient, "encryptedPayload", attempts
    `;
    const row = rows[0];
    if (!row) break;
    try {
      const payload = payloadSchema.parse(
        JSON.parse(openSecret(row.encryptedPayload, "email-outbox")),
      );
      await sendMail({
        ...payload,
        to: row.recipient,
        messageId: `<${row.id}@${new URL(env.NEXT_PUBLIC_APP_URL).hostname}>`,
      });
      await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: "PROCESSING", lockedUntil: lease },
        data: { status: "SENT", deliveredAt: new Date(), lockedUntil: null, lastErrorCode: null },
      });
      sent++;
    } catch {
      // Never log an SMTP error object: transports may contain recipients or private links.
      const exhausted = row.attempts >= 12;
      await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: "PROCESSING", lockedUntil: lease },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          lockedUntil: null,
          lastErrorCode: "DELIVERY_FAILED",
          availableAt: new Date(
            Date.now() + Math.min(3600, 30 * 2 ** Math.min(row.attempts, 7)) * 1000,
          ),
        },
      });
      failed++;
    }
  }
  return { sent, failed };
}

export async function retryFailedEmails() {
  return prisma.emailOutbox.updateMany({
    where: { status: "FAILED" },
    data: { status: "PENDING", attempts: 0, availableAt: new Date(), lastErrorCode: null },
  });
}

export function notificationRevision() {
  return randomUUID();
}
