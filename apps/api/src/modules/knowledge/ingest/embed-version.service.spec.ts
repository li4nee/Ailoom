// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../../common/clock';
import { EmbedVersionService } from './embed-version.service';

const WS = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c00';
const CONTENT = '# One\n\nBody one.\n\n# Two\n\nBody two.';

function build(existing: number[]) {
  const manager = {};
  const ds = {
    transaction: (fn: (manager: unknown) => Promise<void>) => fn(manager),
  };
  const chunks = {
    ordinalsForVersion: vi.fn(() => Promise.resolve(existing)),
    insertMany: vi.fn(() => Promise.resolve()),
  };
  const credentials = { get: vi.fn(() => Promise.resolve({ provider: 'mock' })) };
  const llm = {
    embed: vi.fn((input: { inputs: string[] }) =>
      Promise.resolve({ vectors: input.inputs.map(() => [0.1, 0.2]), tokens: 10 }),
    ),
  };
  const pricing = { cost: vi.fn(() => Promise.resolve({ costUsd: '0' })) };
  const usage = { increment: vi.fn(() => Promise.resolve()) };
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

  const service = new EmbedVersionService(
    ds as never,
    chunks as never,
    credentials as never,
    llm as never,
    pricing as never,
    usage as never,
    clock,
  );
  return { service, chunks, llm };
}

function embed(
  service: EmbedVersionService,
  targets = [{ model: 'm', credentialId: 'c', dim: 2 }],
) {
  return service.embed({
    workspaceId: WS as never,
    botId: 'b1',
    title: 'Doc',
    version: { id: 'v1', content: CONTENT } as never,
    targets,
    signal: new AbortController().signal,
  });
}

describe('EmbedVersionService resume', () => {
  it('re-embeds only the ordinals a killed run did not write', async () => {
    // Two sections make two chunks; a crash left only ordinal 0 behind.
    const fakes = build([0]);

    await embed(fakes.service);

    expect(fakes.llm.embed).toHaveBeenCalledTimes(1);
    expect(fakes.llm.embed).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: ['Doc\nTwo\n\nBody two.'] }),
    );
    expect(fakes.chunks.insertMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rows: [expect.objectContaining({ ordinal: 1 })] }),
    );
  });

  it('skips the model entirely when every ordinal already exists', async () => {
    const fakes = build([0, 1]);

    await embed(fakes.service);

    expect(fakes.llm.embed).not.toHaveBeenCalled();
    expect(fakes.chunks.insertMany).not.toHaveBeenCalled();
  });

  it('embeds the whole version when nothing was written', async () => {
    const fakes = build([]);

    await embed(fakes.service);

    expect(fakes.llm.embed).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: ['Doc\nOne\n\nBody one.', 'Doc\nTwo\n\nBody two.'] }),
    );
    expect(fakes.chunks.insertMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        rows: [expect.objectContaining({ ordinal: 0 }), expect.objectContaining({ ordinal: 1 })],
      }),
    );
  });
});
