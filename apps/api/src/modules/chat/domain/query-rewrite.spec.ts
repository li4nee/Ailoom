// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  buildRewriteContext,
  parseRewrittenQuery,
  redactRewriteContext,
  shouldRewriteQuery,
} from './query-rewrite';

describe('query rewrite context', () => {
  it('only invokes a rewrite for short or referential follow-ups', () => {
    expect(shouldRewriteQuery(['How long is the refund period?', 'And for annual plans?'])).toBe(
      true,
    );
    expect(
      shouldRewriteQuery([
        'How long is the refund period?',
        'Please explain where I can manage billing settings in my customer account',
      ]),
    ).toBe(false);
    expect(shouldRewriteQuery(['And for annual plans?'])).toBe(false);
  });

  it('uses only two bounded latest visitor messages and redacts direct identifiers', () => {
    expect(
      buildRewriteContext([
        'old visitor message',
        'earlier question about returns',
        'My email is person@example.com, call +1 (555) 123-4567',
      ]),
    ).toEqual([
      'earlier question about returns',
      'My email is [redacted email], call [redacted phone]',
    ]);
  });

  it('caps total context by retaining the newest text', () => {
    const result = buildRewriteContext(['a'.repeat(600), 'b'.repeat(600)]);
    expect(result.join('').length).toBe(1_000);
    expect(result.at(-1)).toBe('b'.repeat(600));
    expect(result[0]).toBe('a'.repeat(400));
  });

  it('rejects empty, multiline, structured, or overlong model output', () => {
    expect(parseRewrittenQuery('  ')).toBeNull();
    expect(parseRewrittenQuery('line one\nline two')).toBeNull();
    expect(parseRewrittenQuery('{"query":"refunds"}')).toBeNull();
    expect(parseRewrittenQuery('x'.repeat(501))).toBeNull();
    expect(parseRewrittenQuery(' refund policy for annual plan ')).toBe(
      'refund policy for annual plan',
    );
  });

  it('redacts long numeric identifiers', () => {
    expect(redactRewriteContext('card 4111 1111 1111 1111')).toBe('card [redacted number]');
  });
});
