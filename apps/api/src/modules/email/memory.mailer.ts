// SPDX-License-Identifier: AGPL-3.0-only

import type { Mailer, MailMessage } from './mailer';

/**
 * Records every message instead of delivering it. The int and e2e harnesses bind this to
 * `MAILER`, and a test inspects `sent` to assert on the emails the app produced.
 */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}
