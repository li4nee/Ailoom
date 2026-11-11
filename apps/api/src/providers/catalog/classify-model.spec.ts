// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { classifyModelId } from './classify-model';

describe('classifyModelId', () => {
  it.each([
    ['nomic-embed-text', 'embedding'],
    ['text-embedding-3-small', 'embedding'],
    ['bge-small-en-v1.5', 'embedding'],
    ['multilingual-e5-small', 'embedding'],
    ['all-minilm', 'embedding'],
    ['llama3.1:8b', 'chat'],
    ['gpt-4o-mini', 'chat'],
    ['whisper-large', 'skip'],
    ['tts-1', 'skip'],
    ['dall-e-3', 'skip'],
    ['text-moderation-latest', 'skip'],
    ['gpt-4o-realtime-preview', 'skip'],
    ['gpt-4o-audio-preview', 'skip'],
  ])('classifies %s as %s', (id, kind) => {
    expect(classifyModelId(id)).toBe(kind);
  });
});
