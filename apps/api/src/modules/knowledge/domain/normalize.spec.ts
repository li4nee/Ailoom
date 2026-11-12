// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { contentHash } from './content-hash';
import { normalizeMarkdown } from './normalize';

describe('normalizeMarkdown', () => {
  it('strips zero-width characters and normalizes to NFC', () => {
    expect(normalizeMarkdown('Re\u200Bfund cafe\u0301')).toBe('Refund café');
  });

  it('normalizes newlines and collapses blank lines', () => {
    expect(normalizeMarkdown('a\r\n\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
  });

  it('trims trailing spaces but keeps code blocks intact', () => {
    expect(normalizeMarkdown('x  \n```\n  keep  \n```')).toBe('x\n```\n  keep  \n```');
  });

  it('removes repeated short boilerplate lines, keeping the first', () => {
    expect(normalizeMarkdown('Skip to content\nA\nSkip to content\nB\nSkip to content')).toBe(
      'Skip to content\nA\nB',
    );
  });

  it('keeps repeated list items, headings and table rows', () => {
    expect(normalizeMarkdown('- yes\n- yes\n- yes')).toBe('- yes\n- yes\n- yes');
    expect(normalizeMarkdown('## Prices\n## Prices\n## Prices')).toBe(
      '## Prices\n## Prices\n## Prices',
    );
    expect(normalizeMarkdown('| a | b |\n| a | b |\n| a | b |')).toBe(
      '| a | b |\n| a | b |\n| a | b |',
    );
  });

  it('does not treat text inside a code fence as boilerplate', () => {
    expect(normalizeMarkdown('```\nsame\nsame\nsame\n```')).toBe('```\nsame\nsame\nsame\n```');
  });
});

describe('contentHash', () => {
  it('hash is stable across whitespace-only differences', () => {
    expect(contentHash(normalizeMarkdown('a \n\n\nb'))).toBe(
      contentHash(normalizeMarkdown('a\n\nb')),
    );
  });

  it('is a sha-256 hex digest', () => {
    expect(contentHash('a')).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    );
  });
});
