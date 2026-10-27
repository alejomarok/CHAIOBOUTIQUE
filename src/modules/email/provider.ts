export interface SendEmailInput {
  to: string;
  subject: string;
  html?: string;
  text: string;
  messageId?: string;
}

// Shared by authentication messages and the persistent order-email outbox.
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
