// SPDX-License-Identifier: AGPL-3.0-only
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';

import { createMockLanguageModel } from './mock-models';

describe('createMockLanguageModel', () => {
  it('answers non-streaming calls with the same reply and usage rules', async () => {
    const result = await generateText({
      model: createMockLanguageModel(),
      messages: [{ role: 'user', content: 'ping' }],
      maxOutputTokens: 1,
    });
    expect(result.text).toBe('Mock answer about "ping" [1].');
    expect(result.usage.inputTokens).toBe(Math.ceil('ping'.length / 4));
    expect(result.usage.outputTokens).toBe(Math.ceil(result.text.length / 4));
  });

  it('fails non-streaming calls with failWith', async () => {
    const failure = new Error('down');
    await expect(
      generateText({
        model: createMockLanguageModel({ failWith: failure }),
        prompt: 'ping',
        maxRetries: 0,
      }),
    ).rejects.toBe(failure);
  });
});
