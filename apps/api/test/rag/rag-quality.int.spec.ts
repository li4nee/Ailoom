// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { DataSource } from 'typeorm';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseMarkdownSubset, type MdNode } from '@app/shared';

import { asBotId, asWorkspaceId, type WorkspaceId } from '../../src/db/ids';
import { decideRetrieval } from '../../src/modules/chat/domain/escalation';
import { applyLinkPolicy, buildAllowedLinkHosts } from '../../src/modules/chat/domain/link-policy';
import { chunkMarkdown } from '../../src/modules/knowledge/domain/chunker';
import { RetrievalRepository } from '../../src/modules/retrieval';
import { DEFAULT_MODELS_DIR, localModelStatus } from '../../src/providers/local/catalog';
import { createLocalEmbeddingModel } from '../../src/providers/local/local-embedding-model';
import { ModelCatalog } from '../../src/providers/model-catalog';
import type { EmbedPurpose } from '../../src/providers/types';
import { getTestDataSource, resetDatabase } from '../helpers/db';

const MODEL = 'bge-small-en-v1.5' as const;
const FIXTURES = resolve(__dirname, 'fixtures');
const KB = join(FIXTURES, 'kb');
const HYBRID_KB = join(FIXTURES, 'hybrid-kb');

interface Questions {
  inScope: { q: string; expectedDoc: string }[];
  outOfScope: string[];
}

interface HybridComparisonCases {
  inScope: { question: string; expectedDocument: string }[];
  nearMatchDistractors: { question: string; distractorDocument: string }[];
  outOfScope: string[];
}

interface Seeded {
  workspaceId: WorkspaceId;
  botId: string;
}

interface IndexedChunk {
  doc: string;
  chunkId: string;
}

interface SearchResult {
  doc: string;
  chunkId: string;
  score: number;
  maxScore: number;
}

function hasLinkTo(nodes: MdNode[], fragment: string): boolean {
  return nodes.some((node) => {
    if (node.type === 'link' && node.href.includes(fragment)) return true;
    if (node.type === 'list') return node.items.some((item) => hasLinkTo(item, fragment));
    if ('children' in node) return hasLinkTo(node.children, fragment);
    return false;
  });
}

const model = createLocalEmbeddingModel({
  modelsDir: DEFAULT_MODELS_DIR,
  id: MODEL,
});

async function embed(text: string, purpose: EmbedPurpose): Promise<number[]> {
  const result = await model.doEmbed({
    values: [text],
    providerOptions: { local: { purpose } },
  });
  const vector = result.embeddings[0];
  if (vector === undefined) throw new Error('The local model returned no vector.');
  return vector;
}

let ds: DataSource;
let repo: RetrievalRepository;
let seeded: Seeded;
let indexed: IndexedChunk[];
let questions: Questions;
let threshold: number;

async function seedCorpus(): Promise<void> {
  const workspaces = await ds.query<{ id: string }[]>(
    `INSERT INTO workspaces (name, slug) VALUES ('Northwind', 'northwind-rag') RETURNING id`,
  );
  const workspaceId = asWorkspaceId(workspaces[0]?.id ?? '');
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'local', 'Embeddings') RETURNING id`,
    [workspaceId],
  );
  const embedCredential = credentials[0]?.id ?? '';
  const bots = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, retrieval_threshold)
     VALUES ($1, 'Northwind Support', $2, $3, 'mock-chat', $3, $4, 384, $5) RETURNING id`,
    [workspaceId, 'pk_live_ragquality', embedCredential, MODEL, threshold],
  );
  const botId = bots[0]?.id ?? '';

  const source = await ds.query<{ id: string }[]>(
    `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
     VALUES ($1, $2, 'text', 'Northwind KB', '{}'::jsonb, 'ready') RETURNING id`,
    [workspaceId, botId],
  );

  const chunks: IndexedChunk[] = [];
  for (const file of readdirSync(KB)
    .filter((name) => extname(name) === '.md')
    .sort()) {
    const docName = basename(file, '.md');
    const markdown = readFileSync(join(KB, file), 'utf8');
    const document = await ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [workspaceId, botId, source[0]?.id, docName],
    );
    const documentId = document[0]?.id ?? '';
    const version = await ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [workspaceId, documentId, `hash-${docName}`, markdown],
    );
    const versionId = version[0]?.id ?? '';
    await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
      documentId,
      versionId,
    ]);

    for (const chunk of chunkMarkdown({ title: docName, markdown })) {
      const vector = await embed(chunk.embedText, 'document');
      const row = await ds.query<{ id: string }[]>(
        `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                             content, token_count, embedding, embedding_model, embedding_dim)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, 384) RETURNING id`,
        [
          workspaceId,
          botId,
          versionId,
          chunk.ordinal,
          chunk.headingPath,
          chunk.content,
          chunk.tokenCount,
          `[${vector.join(',')}]`,
          MODEL,
        ],
      );
      chunks.push({ doc: docName, chunkId: row[0]?.id ?? '' });
    }
  }

  seeded = { workspaceId, botId };
  indexed = chunks;
}

async function seedHybridComparisonDocuments(): Promise<void> {
  const source = await ds.query<{ id: string }[]>(
    `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
     VALUES ($1, $2, 'text', 'Hybrid comparison fixtures', '{}'::jsonb, 'ready') RETURNING id`,
    [seeded.workspaceId, seeded.botId],
  );
  for (const file of readdirSync(HYBRID_KB)
    .filter((name) => extname(name) === '.md')
    .sort()) {
    const docName = basename(file, '.md');
    const markdown = readFileSync(join(HYBRID_KB, file), 'utf8');
    const document = await ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [seeded.workspaceId, seeded.botId, source[0]?.id, docName],
    );
    const version = await ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [seeded.workspaceId, document[0]?.id, `hybrid-${docName}`, markdown],
    );
    const versionId = version[0]?.id ?? '';
    await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
      document[0]?.id,
      versionId,
    ]);
    for (const chunk of chunkMarkdown({ title: docName, markdown })) {
      const vector = await embed(chunk.embedText, 'document');
      const row = await ds.query<{ id: string }[]>(
        `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                             content, token_count, embedding, embedding_model, embedding_dim)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, 384) RETURNING id`,
        [
          seeded.workspaceId,
          seeded.botId,
          versionId,
          chunk.ordinal,
          chunk.headingPath,
          chunk.content,
          chunk.tokenCount,
          `[${vector.join(',')}]`,
          MODEL,
        ],
      );
      indexed.push({ doc: docName, chunkId: row[0]?.id ?? '' });
    }
  }
}

async function search(
  question: string,
  mode: 'vector' | 'hybrid' = 'vector',
): Promise<SearchResult[]> {
  const vector = await embed(question, 'query');
  const input = {
    botId: asBotId(seeded.botId),
    embeddingModel: MODEL,
    dim: 384,
    vector,
    limit: 8,
    queryText: question,
  };
  const found =
    mode === 'hybrid'
      ? await repo.searchHybrid(seeded.workspaceId, input, threshold)
      : await repo.search(seeded.workspaceId, input);
  const byId = new Map(indexed.map((entry) => [entry.chunkId, entry.doc]));
  return found.map((chunk) => ({
    doc: byId.get(chunk.chunkId) ?? '',
    chunkId: chunk.chunkId,
    score: chunk.score,
    maxScore: chunk.maxScore ?? chunk.score,
  }));
}

beforeAll(async () => {
  if (localModelStatus(DEFAULT_MODELS_DIR, MODEL) !== 'ready') {
    throw new Error(`The ${MODEL} model is missing: run pnpm --filter @app/api fetch-model first.`);
  }
  threshold = ModelCatalog.embedding('local', MODEL)?.threshold ?? 0;
  questions = JSON.parse(readFileSync(join(FIXTURES, 'questions.json'), 'utf8')) as Questions;

  ds = await getTestDataSource();
  await resetDatabase(ds);
  repo = new RetrievalRepository(ds);
  await seedCorpus();
}, 120_000);

describe('RAG quality', () => {
  it('finds the expected source in the top 5 for every in-scope question', async () => {
    const misses: string[] = [];
    for (const item of questions.inScope) {
      const ranked = await search(item.q);
      const top5 = new Set(ranked.slice(0, 5).map((entry) => entry.doc));
      if (!top5.has(item.expectedDoc)) misses.push(item.q);
    }
    expect(misses).toEqual([]);
  }, 120_000);

  it('answers at least 90% of in-scope questions at the calibrated threshold', async () => {
    let answered = 0;
    for (const item of questions.inScope) {
      const ranked = await search(item.q);
      const decision = decideRetrieval({
        readyChunkCount: indexed.length,
        topScore: ranked[0]?.maxScore ?? null,
        threshold,
      });
      if (decision.kind === 'answer') answered += 1;
    }
    expect(answered / questions.inScope.length).toBeGreaterThanOrEqual(0.9);
  }, 120_000);

  it('escalates at least 80% of out-of-scope questions at the calibrated threshold', async () => {
    let escalated = 0;
    for (const question of questions.outOfScope) {
      const ranked = await search(question);
      const decision = decideRetrieval({
        readyChunkCount: indexed.length,
        topScore: ranked[0]?.maxScore ?? null,
        threshold,
      });
      if (decision.kind === 'escalate') escalated += 1;
    }
    expect(escalated / questions.outOfScope.length).toBeGreaterThanOrEqual(0.8);
  }, 120_000);

  it('preserves support recall and out-of-scope handoffs across the RAG evaluation set', async () => {
    let vectorExpectedHits = 0;
    let hybridExpectedHits = 0;
    let vectorAnswered = 0;
    let hybridAnswered = 0;
    let vectorHandoffs = 0;
    let hybridHandoffs = 0;

    for (const item of questions.inScope) {
      const vector = await search(item.q, 'vector');
      const hybrid = await search(item.q, 'hybrid');
      if (vector.slice(0, 5).some((result) => result.doc === item.expectedDoc)) {
        vectorExpectedHits += 1;
      }
      if (hybrid.slice(0, 5).some((result) => result.doc === item.expectedDoc)) {
        hybridExpectedHits += 1;
      }
      if (
        decideRetrieval({
          readyChunkCount: indexed.length,
          topScore: vector[0]?.maxScore ?? null,
          threshold,
        }).kind === 'answer'
      ) {
        vectorAnswered += 1;
      }
      if (
        decideRetrieval({
          readyChunkCount: indexed.length,
          topScore: hybrid[0]?.maxScore ?? null,
          threshold,
        }).kind === 'answer'
      ) {
        hybridAnswered += 1;
      }
    }

    for (const question of questions.outOfScope) {
      const vector = await search(question, 'vector');
      const hybrid = await search(question, 'hybrid');
      if (
        decideRetrieval({
          readyChunkCount: indexed.length,
          topScore: vector[0]?.maxScore ?? null,
          threshold,
        }).kind === 'escalate'
      ) {
        vectorHandoffs += 1;
      }
      if (
        decideRetrieval({
          readyChunkCount: indexed.length,
          topScore: hybrid[0]?.maxScore ?? null,
          threshold,
        }).kind === 'escalate'
      ) {
        hybridHandoffs += 1;
      }
    }

    expect(hybridExpectedHits).toBeGreaterThanOrEqual(vectorExpectedHits);
    expect(hybridAnswered).toBeGreaterThanOrEqual(vectorAnswered);
    expect(hybridHandoffs).toBeGreaterThanOrEqual(vectorHandoffs);
  }, 120_000);

  it('retrieves the injection doc and never makes its URL clickable', async () => {
    const ranked = await search('How long is the Northwind Trail loop?');
    expect(ranked[0]?.doc).toBe('injection');

    const injection = indexed.find((entry) => entry.doc === 'injection');
    const source = await ds.query<{ content: string }[]>(
      `SELECT content FROM chunks WHERE id = $1`,
      [injection?.chunkId],
    );
    const content = source[0]?.content ?? '';

    // A bare URL in the source is plain text, never a link node.
    expect(hasLinkTo(parseMarkdownSubset(content), 'evil.test')).toBe(false);
    // If the model formats it as Markdown anyway, the answer link policy strips the link.
    const rendered = applyLinkPolicy(
      content.replace('https://evil.test', '[claim prize](https://evil.test)'),
      buildAllowedLinkHosts({
        usedSourceUrls: [],
        allowedOrigins: [],
        allowedLinkDomains: [],
      }),
    );
    expect(rendered).not.toContain('](https://evil.test');
    expect(rendered).toContain('claim prize');
  });

  it('compares hybrid exact-identifier recall and out-of-scope handoffs with vector baseline', async () => {
    await seedHybridComparisonDocuments();
    const fixtures = JSON.parse(
      readFileSync(join(FIXTURES, 'hybrid-comparison.json'), 'utf8'),
    ) as HybridComparisonCases;
    const topFiveHit = async (
      question: string,
      expectedDocument: string,
      mode: 'vector' | 'hybrid',
    ) =>
      (await search(question, mode)).slice(0, 5).some((result) => result.doc === expectedDocument);

    let vectorExactHits = 0;
    let hybridExactHits = 0;
    for (const item of fixtures.inScope) {
      if (await topFiveHit(item.question, item.expectedDocument, 'vector')) vectorExactHits += 1;
      if (await topFiveHit(item.question, item.expectedDocument, 'hybrid')) hybridExactHits += 1;
    }
    for (const item of fixtures.nearMatchDistractors) {
      const results = await search(item.question, 'hybrid');
      expect(results[0]?.doc).not.toBe(item.distractorDocument);
    }

    let vectorHandoffs = 0;
    let hybridHandoffs = 0;
    for (const question of fixtures.outOfScope) {
      const vector = await search(question, 'vector');
      const hybrid = await search(question, 'hybrid');
      if (
        decideRetrieval({
          readyChunkCount: indexed.length,
          topScore: vector[0]?.maxScore ?? null,
          threshold,
        }).kind === 'escalate'
      )
        vectorHandoffs += 1;
      if (
        decideRetrieval({
          readyChunkCount: indexed.length,
          topScore: hybrid[0]?.maxScore ?? null,
          threshold,
        }).kind === 'escalate'
      )
        hybridHandoffs += 1;
    }

    expect(hybridExactHits).toBeGreaterThanOrEqual(vectorExactHits);
    expect(hybridHandoffs).toBeGreaterThanOrEqual(vectorHandoffs);
  }, 120_000);
});
