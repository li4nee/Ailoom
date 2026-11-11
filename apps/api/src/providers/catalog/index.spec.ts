// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { CATALOG } from './index';

describe('provider catalog', () => {
  it('has one entry for every byok provider', () => {
    expect(Object.keys(CATALOG).sort()).toEqual([
      'anthropic',
      'gemini',
      'groq',
      'mistral',
      'ollama',
      'openai',
      'openai_compatible',
    ]);
  });

  it('declares which providers can embed', () => {
    const withEmbeddings = Object.values(CATALOG)
      .filter((provider) => provider.createEmbeddingModel !== null)
      .map((provider) => provider.kind)
      .sort();
    expect(withEmbeddings).toEqual(['gemini', 'mistral', 'ollama', 'openai', 'openai_compatible']);
  });
});
