// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { parseTarget } from './parse-target';

describe('parseTarget', () => {
  it.each(['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/'])(
    '%s normalizes to 127.0.0.1',
    (raw) => {
      expect(parseTarget(raw).host).toBe('127.0.0.1');
    },
  );

  it.each(['file:///etc/passwd', 'gopher://x', 'ftp://x'])('%s is blocked', (raw) => {
    expect(() => parseTarget(raw)).toThrow(expect.objectContaining({ code: 'blocked_scheme' }));
  });

  it('defaults ports', () => {
    expect(parseTarget('https://a.com').port).toBe(443);
    expect(parseTarget('http://a.com').port).toBe(80);
  });
});
