import "server-only";

import { EmailDeliveryError } from "./provider";
import type { EmailProvider } from "./provider";
import { SmtpEmailProvider } from "./smtp-provider";

let provider: EmailProvider | null = null;

function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider = new SmtpEmailProvider();
  }
  return provider;
}

export { EmailDeliveryError } from "./provider";
export type { EmailProvider, SendEmailInput } from "./provider";

export async function sendPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  try {
    await getEmailProvider().send({
      to: input.to,
      subject: "Recuperar tu contraseña — CHAIOBOUTIQUE",
      html: `
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${input.resetUrl}">Hacé clic acá para elegir una nueva contraseña</a></p>
        <p>Si no fuiste vos, podés ignorar este mensaje.</p>
      `,
      text: `Para restablecer tu contraseña, visitá: ${input.resetUrl}`,
    });
  } catch (error) {
    // Safe to log: this is a transport-level failure (e.g. Mailpit not
    // running), never the reset URL/token itself.
    console.error("Password reset email delivery failed.", error);
    throw new EmailDeliveryError(error);
  }
}
