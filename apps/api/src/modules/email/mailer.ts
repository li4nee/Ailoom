// SPDX-License-Identifier: AGPL-3.0-only

/** One outgoing email, fully rendered: nothing below this layer knows about templates. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Delivers one rendered email. Implementations: SMTP (`SmtpMailer`), Resend
 * (`ResendMailer`), the log (`LogMailer`) and memory (`MemoryMailer`, tests only).
 */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** The DI token bound to the transport chosen from the configuration. */
export const MAILER = Symbol('MAILER');
