// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { detectHandoffIntent, normalizeForIntent } from './handoff-intent';

describe('normalizeForIntent', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeForIntent('  TALK   to a human!! ')).toBe('talk to a human');
  });

  it('keeps letters and numbers of any script', () => {
    expect(normalizeForIntent('Ich möchte mit einem Menschen sprechen')).toBe(
      'ich möchte mit einem menschen sprechen',
    );
  });
});

describe('detectHandoffIntent', () => {
  it.each([
    ['Can I talk to a human?', true],
    ['TALK TO A HUMAN please!!', true],
    ['customer service', true],
    ['Is your API human-readable?', false],
    ['human', false],
    ['agent', false],
    ['I am a real personality', false],
    [
      'I read the customer service page and still have a question about refunds on annual plans today',
      false,
    ],
  ])('%s → %s', (message, expected) => {
    expect(detectHandoffIntent(message, null)).toBe(expected);
  });

  it('uses custom phrases instead of defaults', () => {
    expect(
      detectHandoffIntent('Ich möchte mit einem Menschen sprechen', [
        'mit einem menschen sprechen',
      ]),
    ).toBe(true);
    expect(detectHandoffIntent('talk to a human', ['mit einem menschen sprechen'])).toBe(false);
  });

  it('empty phrase list never matches', () => {
    expect(detectHandoffIntent('talk to a human', [])).toBe(false);
  });
});
