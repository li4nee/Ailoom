// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { LogMailer } from './log.mailer';

/** Records every `info` call; stands in for PinoLogger. */
class CapturingSink {
  readonly calls: { obj: unknown; msg: string | undefined }[] = [];

  info(obj: unknown, msg?: string): void {
    this.calls.push({ obj, msg });
  }
}

describe('LogMailer', () => {
  it('logs the recipient and subject at info, never the body', async () => {
    const sink = new CapturingSink();
    const mailer = new LogMailer(sink);

    await mailer.send({
      to: 'a@b.c',
      subject: 'Verify your email',
      text: 'secret body text',
      html: '<html>secret body html</html>',
    });

    expect(sink.calls).toHaveLength(1);
    const logged = JSON.stringify(sink.calls[0]);
    expect(logged).toContain('a@b.c');
    expect(logged).toContain('Verify your email');
    expect(logged).not.toContain('secret body');
  });
});
