import "server-only";

import nodemailer from "nodemailer";

import { env } from "@/lib/env";

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
    });
  }
}
