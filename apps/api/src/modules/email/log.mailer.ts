// SPDX-License-Identifier: AGPL-3.0-only

import type { Mailer, MailMessage } from './mailer';

/**
 * The one PinoLogger method this mailer needs. An interface, not the class, so a test can
 * stand in with a capture sink and the module need not depend on the logging module here.
 */
export interface InfoLogSink {
  info(obj: unknown, msg?: string, ...args: unknown[]): void;
}

/**
 * "Delivers" by writing one info line. This is what `EMAIL_TRANSPORT=none` binds, so the
 * worker runs unchanged in development without SMTP credentials.
 */
export class LogMailer implements Mailer {
  constructor(private readonly sink: InfoLogSink) {}

  send(message: MailMessage): Promise<void> {
    // Only the envelope goes to the log: the body carries personal data and action tokens.
    this.sink.info({ to: message.to, subject: message.subject }, 'email delivered (log transport)');
    return Promise.resolve();
  }
}
