import { createHash } from "node:crypto";
import { env } from "@/lib/env-core";
import { EmailDeliveryError, type EmailProvider, type SendEmailInput } from "./provider";

export class ResendEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<void> {
    if (!env.RESEND_API_KEY) throw new EmailDeliveryError();
    if (
      env.RESEND_TEST_RECIPIENT &&
      input.to.toLowerCase() !== env.RESEND_TEST_RECIPIENT.toLowerCase()
    )
      throw new EmailDeliveryError();
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          ...(input.messageId
            ? {
                "Idempotency-Key": `chaio/${createHash("sha256").update(input.messageId).digest("hex")}`,
              }
            : {}),
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          html: input.html,
          reply_to: env.EMAIL_REPLY_TO,
          ...(input.messageId ? { headers: { "Message-ID": input.messageId } } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.error("[email] Resend rejected delivery", { status: response.status });
        throw new EmailDeliveryError();
      }
      const result = (await response.json()) as { id?: unknown };
      if (typeof result.id !== "string" || !result.id) throw new EmailDeliveryError();
    } catch {
      // Provider responses may contain private reset links or recipient data.
      throw new EmailDeliveryError();
    }
  }
}
