// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { buildRetrievalQuery } from './retrieval-query';

describe('buildRetrievalQuery', () => {
  it('joins a short follow-up to the previous visitor message', () => {
    expect(buildRetrievalQuery(['What is the refund window?', 'and for annual plans?'])).toBe(
      'What is the refund window?\nand for annual plans?',
    );
  });

  it('uses only the latest message when it is long enough', () => {
    expect(buildRetrievalQuery(['a', 'What is the refund window for annual plans?'])).toBe(
      'What is the refund window for annual plans?',
    );
  });

  it('returns a single message unchanged', () => {
    expect(buildRetrievalQuery(['What is the refund window?'])).toBe('What is the refund window?');
  });

  it('returns a lone short message unchanged', () => {
    expect(buildRetrievalQuery(['refunds?'])).toBe('refunds?');
  });

  it('throws on an empty history', () => {
    expect(() => buildRetrievalQuery([])).toThrow();
  });
});
