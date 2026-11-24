// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable local/no-process-env -- perf harnesses are configured by the workflow */
/**
 * Retrieval p95 with 100k chunks of 384 dimensions across 50 bots (M7 Task 7.6).
 *
 *   DATABASE_URL=postgres://... pnpm --filter @app/api exec \
 *     node -r @swc-node/register test/perf/retrieval-latency.ts
 *
 * Seeds its own workspace, runs 1,000 `RetrievalRepository.search` calls and exits 1
 * when p95 >= 50 ms.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from '../../src/db/data-source';
import { asBotId, asWorkspaceId } from '../../src/db/ids';
import { RetrievalRepository } from '../../src/modules/retrieval/retrieval.repository';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://app:app@localhost:5432/app';
const CHUNKS = 100_000;
const BOTS = 50;
const SEARCHES = 1_000;
const DIM = 384;
const TARGET_P95_MS = 50;
const vector = Array.from({ length: DIM }, () => 0.01);

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN
  );
}

async function main(): Promise<void> {
  const ds = new DataSource(
    buildDataSourceOptions({ url: DATABASE_URL, listenUrl: DATABASE_URL, ssl: false, sslCa: null }),
  );
  await ds.initialize();
  const startedAt = performance.now();
  try {
    const slug = `perf-retrieval-${String(Date.now())}`;
    const workspaces = await ds.query<{ id: string }[]>(
      `INSERT INTO workspaces (name, slug) VALUES ('Perf retrieval', $1) RETURNING id`,
      [slug],
    );
    const workspaceId = workspaces[0]?.id ?? '';
    const credentials = await ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Perf'), ($1, 'mock', 'Perf chat') RETURNING id`,
      [workspaceId],
    );
    const localCredentialId = credentials[0]?.id ?? '';
    const chatCredentialId = credentials[1]?.id ?? '';

    const bots: { id: string; versionId: string }[] = [];
    for (let index = 0; index < BOTS; index += 1) {
      const botsRows = await ds.query<{ id: string }[]>(
        `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                           embedding_credential_id, embedding_model, embedding_dim,
                           retrieval_threshold)
         VALUES ($1, $2, $3, $4, 'mock-chat', $5, 'bge-small-en-v1.5', 384, 0.3)
         RETURNING id`,
        [
          workspaceId,
          `Perf bot ${String(index)}`,
          `pk_live_perf_${String(index)}_${String(Date.now())}`,
          chatCredentialId,
          localCredentialId,
        ],
      );
      const botId = botsRows[0]?.id ?? '';
      const source = await ds.query<{ id: string }[]>(
        `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
         VALUES ($1, $2, 'text', 'Perf', '{}'::jsonb, 'ready') RETURNING id`,
        [workspaceId, botId],
      );
      const document = await ds.query<{ id: string }[]>(
        `INSERT INTO documents (workspace_id, bot_id, source_id, title)
         VALUES ($1, $2, $3, 'Perf document') RETURNING id`,
        [workspaceId, botId, source[0]?.id],
      );
      const version = await ds.query<{ id: string }[]>(
        `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
         VALUES ($1, $2, $3, 'Perf content') RETURNING id`,
        [workspaceId, document[0]?.id, `perf-${String(index)}`],
      );
      const versionId = version[0]?.id ?? '';
      await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
        document[0]?.id,
        versionId,
      ]);
      bots.push({ id: botId, versionId });
    }

    const perBot = CHUNKS / BOTS;
    for (const [index, bot] of bots.entries()) {
      await ds.query(
        `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                             content, token_count, embedding, embedding_model, embedding_dim)
         SELECT $1, $2, $3, g, '# Perf', 'Refund content ' || g, 3,
                array_fill(0.01::real, ARRAY[384])::vector, 'bge-small-en-v1.5', 384
           FROM generate_series(0, $4 - 1) g`,
        [workspaceId, bot.id, bot.versionId, perBot],
      );
      if ((index + 1) % 10 === 0) {
        process.stderr.write(`retrieval: seeded ${String((index + 1) * perBot)} chunks\n`);
      }
    }

    // Measure a settled table, as in steady-state production: fresh statistics and a current
    // visibility map, instead of racing autovacuum on 100,000 just-inserted rows.
    await ds.query('VACUUM (ANALYZE) chunks');
    await ds.query('VACUUM (ANALYZE) documents');

    const repository = new RetrievalRepository(ds);
    const bot = bots[0];
    if (bot === undefined) throw new Error('no seeded bot');
    const search = () =>
      repository.search(asWorkspaceId(workspaceId), {
        botId: asBotId(bot.id),
        embeddingModel: 'bge-small-en-v1.5',
        dim: DIM,
        vector,
        limit: 8,
      });
    // Warm the connection pool and planner cache before measuring.
    await Promise.all(Array.from({ length: 20 }, search));

    const samples: number[] = [];
    for (let index = 0; index < SEARCHES; index += 1) {
      const started = performance.now();
      await search();
      samples.push(performance.now() - started);
    }

    const report = {
      target: 'p95 < 50 ms',
      chunks: CHUNKS,
      bots: BOTS,
      dimensions: DIM,
      searches: SEARCHES,
      seedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(1)),
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      p99: percentile(samples, 99),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    const output = process.env['PERF_OUTPUT'];
    if (output !== undefined) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (report.p95 >= TARGET_P95_MS) process.exitCode = 1;
  } finally {
    await ds.destroy();
  }
}

void main();
