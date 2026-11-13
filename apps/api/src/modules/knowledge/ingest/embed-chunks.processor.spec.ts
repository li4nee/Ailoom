// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { EmbedChunksProcessor } from './embed-chunks.processor';

const WS = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c00';
const OLD = 'mock-embed';
const ACTIVE = 'mock-embed-alt';
const PENDING = 'mock-embed-large';

function build(bot: Record<string, unknown>) {
  const credentials = { get: vi.fn(() => Promise.resolve({ provider: 'mock' })) };
  const documents = {
    findByVersionId: vi.fn(() => Promise.resolve({ id: 'd1', sourceId: 's1', title: 'Doc' })),
  };
  const sources = {
    findById: vi.fn(() =>
      Promise.resolve({ id: 's1', botId: 'b1', status: 'ready', title: 'Site' }),
    ),
  };
  const bots = { findById: vi.fn(() => Promise.resolve(bot)) };
  const versions = { findById: vi.fn(() => Promise.resolve({ id: 'v1', content: '# Doc' })) };
  const embedVersion = { embed: vi.fn(() => Promise.resolve({ cancelled: false })) };
  const versioning = { swapCurrentVersion: vi.fn(() => Promise.resolve()) };
  const progress = { fail: vi.fn(() => Promise.resolve()) };

  const processor = new EmbedChunksProcessor(
    credentials as never,
    documents as never,
    sources as never,
    bots as never,
    versions as never,
    embedVersion as never,
    versioning as never,
    progress as never,
  );
  return { processor, credentials, embedVersion, versioning, progress };
}

function botRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    deletedAt: null,
    embeddingModel: ACTIVE,
    embeddingCredentialId: 'cred-active',
    embeddingDim: 384,
    pendingEmbeddingModel: null,
    pendingEmbeddingCredentialId: null,
    pendingEmbeddingDim: null,
    ...over,
  };
}

const payload = {
  workspaceId: WS,
  botId: 'b1',
  documentVersionId: 'v1',
  embeddingModel: OLD,
};

describe('EmbedChunksProcessor targets', () => {
  it('embeds the bot active model, not the model the job was queued under', async () => {
    // The page was enqueued while the bot used OLD; a re-embed to ACTIVE finished first.
    const fakes = build(botRow());

    await fakes.processor.handle(payload, { signal: new AbortController().signal });

    expect(fakes.embedVersion.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [{ model: ACTIVE, credentialId: 'cred-active', dim: 384 }],
      }),
    );
    expect(fakes.versioning.swapCurrentVersion).toHaveBeenCalled();
  });

  it('adds the pending model next to the active one during a re-embed', async () => {
    const fakes = build(
      botRow({
        pendingEmbeddingModel: PENDING,
        pendingEmbeddingCredentialId: 'cred-pending',
        pendingEmbeddingDim: 768,
      }),
    );

    await fakes.processor.handle(payload, { signal: new AbortController().signal });

    expect(fakes.embedVersion.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          { model: ACTIVE, credentialId: 'cred-active', dim: 384 },
          { model: PENDING, credentialId: 'cred-pending', dim: 768 },
        ],
      }),
    );
  });
});
