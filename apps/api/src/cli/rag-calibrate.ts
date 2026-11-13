// SPDX-License-Identifier: AGPL-3.0-only
// Calibrates the default retrieval threshold from the RAG fixture set (spec §23.4):
//   pnpm --filter @app/api rag:calibrate [--model local:bge-small-en-v1.5]
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { LocalEmbeddingModelId } from '../common/config';
import { chunkMarkdown } from '../modules/knowledge/domain/chunker';
import { DEFAULT_MODELS_DIR, isLocalModelId } from '../providers/local/catalog';
import { createLocalEmbeddingModel } from '../providers/local/local-embedding-model';
import type { EmbedPurpose, EmbeddingModel } from '../providers/types';

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

const FIXTURES = resolve(__dirname, '../../test/rag/fixtures');
const KB = join(FIXTURES, 'kb');

interface Questions {
  inScope: { q: string; expectedDoc: string }[];
  outOfScope: string[];
}

interface ScoredChunk {
  doc: string;
  score: number;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

async function embedAll(
  model: EmbeddingModel,
  texts: string[],
  purpose: EmbedPurpose,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (const text of texts) {
    const result = await model.doEmbed({
      values: [text],
      providerOptions: { local: { purpose } },
    });
    const vector = result.embeddings[0];
    if (vector === undefined) throw new Error('The embedding model returned no vector.');
    vectors.push(vector);
  }
  return vectors;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)));
  return sorted[index] ?? 0;
}

function modelIdOf(arg: string | undefined): { modelsDir: string; id: LocalEmbeddingModelId } {
  const value = arg ?? 'local:bge-small-en-v1.5';
  if (!value.startsWith('local:')) {
    throw new Error(
      `Only local:<model> can be calibrated here (got ${value}). ollama:nomic-embed-text is calibrated through the manual live workflow (docs/spec.md §23.4).`,
    );
  }
  const id = value.slice('local:'.length);
  if (!isLocalModelId(id)) {
    throw new Error(`Unknown local embedding model: ${id}`);
  }
  return { modelsDir: DEFAULT_MODELS_DIR, id };
}

export async function calibrate(modelArg?: string): Promise<void> {
  const { modelsDir, id } = modelIdOf(modelArg);
  const model = createLocalEmbeddingModel({ modelsDir, id });
  const questions = JSON.parse(readFileSync(join(FIXTURES, 'questions.json'), 'utf8')) as Questions;

  const docs = readdirSync(KB)
    .filter((file) => extname(file) === '.md')
    .sort()
    .map((file) => ({
      name: basename(file, '.md'),
      title: basename(file, '.md').replace(/-/g, ' '),
      markdown: readFileSync(join(KB, file), 'utf8'),
    }));

  const drafts = docs.flatMap((doc) =>
    chunkMarkdown({ title: doc.title, markdown: doc.markdown }).map((chunk) => ({
      doc: doc.name,
      text: chunk.embedText,
    })),
  );

  log(`Embedding ${String(drafts.length)} chunks from ${String(docs.length)} docs with ${id}…`);
  const chunkVectors = await embedAll(
    model,
    drafts.map((draft) => draft.text),
    'document',
  );

  const rank = async (question: string): Promise<ScoredChunk[]> => {
    const [query] = await embedAll(model, [question], 'query');
    if (query === undefined) throw new Error('No query vector.');
    return drafts
      .map((draft, index) => ({
        doc: draft.doc,
        score: dot(query, chunkVectors[index] ?? []),
      }))
      .sort((a, b) => b.score - a.score);
  };

  let hits = 0;
  const inScopeTop: number[] = [];
  for (const item of questions.inScope) {
    const ranked = await rank(item.q);
    const top5 = new Set(ranked.slice(0, 5).map((entry) => entry.doc));
    if (top5.has(item.expectedDoc)) hits += 1;
    inScopeTop.push(ranked[0]?.score ?? 0);
  }

  const outOfScopeTop: number[] = [];
  for (const question of questions.outOfScope) {
    const ranked = await rank(question);
    outOfScopeTop.push(ranked[0]?.score ?? 0);
  }

  const recall = hits / questions.inScope.length;
  const inSorted = [...inScopeTop].sort((a, b) => a - b);
  const outSorted = [...outOfScopeTop].sort((a, b) => a - b);
  const low = percentile(inSorted, 0.1);
  const high = percentile(outSorted, 0.9);
  const suggested = Math.round(((low + high) / 2) * 1000) / 1000;

  log(`recall@5: ${recall.toFixed(3)} (${String(hits)}/${String(questions.inScope.length)})`);
  log(`in-scope top-score p10: ${low.toFixed(3)}`);
  log(`out-of-scope top-score p90: ${high.toFixed(3)}`);
  log(`suggested threshold: ${suggested.toFixed(3)}`);
}

const invokedDirectly = typeof require !== 'undefined' && require.main === module;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const modelIndex = args.indexOf('--model');
  calibrate(modelIndex === -1 ? undefined : args[modelIndex + 1]).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
