export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Provider abstraction so domain code (password reset, future order/shipment
// notifications) never talks to a specific vendor directly. Only the SMTP
// (Mailpit) implementation is wired up this phase — Resend is documented in
// INTEGRATIONS.md as the planned production provider, not yet implemented.
export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(cause?: unknown) {
    super("No se pudo enviar el correo electrónico.");
    this.name = "EmailDeliveryError";
    this.cause = cause;
  }
}
