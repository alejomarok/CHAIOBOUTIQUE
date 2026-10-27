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
  } catch {
    console.error("Password reset email delivery failed.");
    throw new EmailDeliveryError();
  }
}

export async function sendVerificationEmail(input: {
  to: string;
  verifyUrl: string;
}): Promise<void> {
  try {
    await getEmailProvider().send({
      to: input.to,
      subject: "Confirmá tu email — CHAIOBOUTIQUE",
      html: `
        <p>Gracias por registrarte en CHAIOBOUTIQUE.</p>
        <p><a href="${input.verifyUrl}">Hacé clic acá para confirmar tu email</a></p>
        <p>Si no fuiste vos, podés ignorar este mensaje.</p>
      `,
      text: `Para confirmar tu email, visitá: ${input.verifyUrl}`,
    });
  } catch {
    console.error("Verification email delivery failed.");
    throw new EmailDeliveryError();
  }
}
