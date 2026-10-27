import nodemailer from "nodemailer";

import { env } from "@/lib/env-core";

import type { EmailProvider, SendEmailInput } from "./provider";

// Talks to whatever SMTP_HOST/SMTP_PORT point at. In dev this is Mailpit
// (docker-compose.yml), a local catcher — nothing is actually delivered, so
// this is explicitly a non-production implementation until a real SMTP
// relay or Resend (see INTEGRATIONS.md) is configured for the same host/port.
export class SmtpEmailProvider implements EmailProvider {
  private transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS:
      env.NODE_ENV === "production" && !["localhost", "127.0.0.1"].includes(env.SMTP_HOST),
    connectionTimeout: 8000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });

  async send(input: SendEmailInput): Promise<void> {
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      messageId: input.messageId,
      replyTo: env.EMAIL_REPLY_TO,
    });
  }
}
