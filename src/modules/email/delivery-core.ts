import { env } from "@/lib/env-core";
import type { EmailProvider } from "./provider";
import { ResendEmailProvider } from "./resend-provider";
import { SmtpEmailProvider } from "./smtp-provider";

let provider: EmailProvider | null = null;
export function getEmailProvider(): EmailProvider {
  provider ??=
    env.EMAIL_PROVIDER === "resend" ? new ResendEmailProvider() : new SmtpEmailProvider();
  return provider;
}
