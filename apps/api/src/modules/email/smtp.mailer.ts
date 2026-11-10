// SPDX-License-Identifier: AGPL-3.0-only
import { createTransport, type SMTPTransportOptions, type Transporter } from 'nodemailer';

import type { AppConfig } from '../../common/config';
import type { Mailer, MailMessage } from './mailer';

/** The SMTP settings the configuration has already validated. */
export type SmtpMailerOptions = Extract<AppConfig['email'], { transport: 'smtp' }>;

/**
 * Delivers through an SMTP server (nodemailer, one connection per message, no idle pool to
 * clean up). A rejected send throws, which fails the job and retries it per its definition.
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(options: SmtpMailerOptions) {
    const settings: SMTPTransportOptions = {
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user === null ? {} : { auth: { user: options.user, pass: options.pass ?? '' } }),
    };
    this.transporter = createTransport(settings);
    this.from = options.from;
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
