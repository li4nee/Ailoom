// SPDX-License-Identifier: AGPL-3.0-only
import { Resend } from 'resend';

import type { AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import type { Mailer, MailMessage } from './mailer';

/** The Resend settings the configuration has already validated. */
export type ResendMailerOptions = Extract<AppConfig['email'], { transport: 'resend' }>;

/**
 * Delivers through the Resend HTTP API. The SDK targets one fixed public host (never a
 * user-supplied URL), so the global `fetch` it uses is fine. An API error throws, which
 * fails the job and retries it per its definition.
 */
export class ResendMailer implements Mailer {
  private readonly client: Resend;
  private readonly from: string;

  constructor(options: ResendMailerOptions) {
    this.client = new Resend(options.apiKey);
    this.from = options.from;
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error !== null) {
      throw new AppError('internal_error', {
        message: 'Resend rejected the email.',
        cause: error,
      });
    }
  }
}
