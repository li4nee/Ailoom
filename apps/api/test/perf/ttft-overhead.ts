// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable local/no-process-env -- perf harnesses are configured by the workflow */
/**
 * TTFT overhead under 20 concurrent widget conversations for 60 s (M7 Task 7.6).
 *
 * Run against the perf overlay after `pnpm db:seed`:
 *   API_URL=http://localhost:13000 PUBLIC_URL=http://localhost:18090 \
 *     pnpm --filter @app/api exec node -r @swc-node/register test/perf/ttft-overhead.ts
 *
 * Measures request start to the first `answer.delta`. Exits 1 when p95 >= 300 ms.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Client } from 'pg';

import { createMockEmbeddingModel } from '../../src/providers/mock/mock-models';

const API_URL = process.env['API_URL'] ?? 'http://localhost:18090';
const APP_ORIGIN = process.env['PUBLIC_URL'] ?? API_URL;
const DATABASE_URL = process.env['DATABASE_URL'];
const BOT_PUBLIC_KEY = process.env['BOT_PUBLIC_KEY'] ?? 'pk_live_northwind_demo';
const ORIGIN = process.env['WIDGET_ORIGIN'] ?? 'http://localhost:8090';
const CONCURRENCY = Number(process.env['PERF_CONCURRENCY'] ?? 20);
const DURATION_S = Number(process.env['PERF_DURATION_S'] ?? 60);
const TARGET_P95_MS = 300;
const maxLatency = 30_000;
const question = 'What is the refund window?';

interface Sample {
  ms: number;
  ok: boolean;
  error?: unknown;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN
  );
}

async function post(path: string, token: string | null, body: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

/** Reads SSE until the first answer.delta, then aborts the rest of the stream. */
async function firstDelta(response: Response): Promise<boolean> {
  const reader = response.body?.getReader();
  if (reader === undefined) return false;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error(`stream ended before a delta: ${buffer.slice(0, 300)}`);
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('event: answer.delta')) return true;
      if (buffer.includes('event: escalated') || buffer.includes('event: answer.error')) {
        throw new Error(`stream did not answer: ${buffer.slice(0, 300)}`);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

interface Visitor {
  token: string;
  conversationId: string;
}

/**
 * The demo bot embeds with the real ONNX model, which measures the model rather than the
 * answer path. When DATABASE_URL is set, create a bot whose chat and embedding providers are
 * both the zero-latency mock and seed one matching chunk.
 */
async function prepareMockBot(): Promise<string> {
  if (DATABASE_URL === undefined) return BOT_PUBLIC_KEY;
  const login = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify({ email: 'dev@example.com', password: 'devpassword' }),
  });
  if (!login.ok) throw new Error(`login ${String(login.status)}: ${await login.text()}`);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const authHeaders = { Cookie: cookie, 'X-Requested-With': 'fetch', Origin: APP_ORIGIN };
  const workspaces = (await (
    await fetch(`${API_URL}/api/v1/workspaces`, { headers: authHeaders })
  ).json()) as { id: string }[];
  const workspaceId = workspaces[0]?.id;
  if (workspaceId === undefined) throw new Error('perf setup: no workspace');

  const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };
  const create = async (path: string, body: unknown) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`perf setup ${path}: ${await response.text()}`);
    return (await response.json()) as Record<string, string>;
  };
  const credential = await create(`/api/v1/workspaces/${workspaceId}/credentials`, {
    provider: 'mock',
    label: 'Perf mock',
  });
  const bot = await create(`/api/v1/workspaces/${workspaceId}/bots`, {
    name: 'Perf mock bot',
    chatCredentialId: credential['id'],
    chatModel: 'mock-chat',
    embeddingCredentialId: credential['id'],
    embeddingModel: 'mock-embed',
    retrievalThreshold: 0,
    allowedOrigins: [ORIGIN],
  });

  const embedder = createMockEmbeddingModel({ dimensions: 384, modelId: 'mock-embed' });
  const embedded = await embedder.doEmbed({ values: [question] });
  const vector = embedded.embeddings[0] ?? [];
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const source = await client.query<{ id: string }>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
       VALUES ($1, $2, 'text', 'Perf', '{}'::jsonb, 'ready') RETURNING id`,
      [workspaceId, bot['id']],
    );
    const document = await client.query<{ id: string }>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'Perf document') RETURNING id`,
      [workspaceId, bot['id'], source.rows[0]?.id],
    );
    const version = await client.query<{ id: string }>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       VALUES ($1, $2, $3, 'Perf content') RETURNING id`,
      [workspaceId, document.rows[0]?.id, `perf-${String(Date.now())}`],
    );
    await client.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
      document.rows[0]?.id,
      version.rows[0]?.id,
    ]);
    await client.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                           content, token_count, embedding, embedding_model, embedding_dim)
       VALUES ($1, $2, $3, 0, '# Perf', $4, 3, $5::vector, 'mock-embed', 384)`,
      [workspaceId, bot['id'], version.rows[0]?.id, question, `[${vector.join(',')}]`],
    );
    // This benchmark measures the answer path, not relevance calibration: accept any score.
    await client.query(`UPDATE bots SET retrieval_threshold = -1 WHERE id = $1`, [bot['id']]);
  } finally {
    await client.end();
  }
  const publicKey = bot['publicKey'];
  if (publicKey === undefined) throw new Error('perf setup: bot returned no public key');
  return publicKey;
}

/** One visitor session and conversation, created before the timed run. */
async function createVisitor(publicKey: string): Promise<Visitor> {
  const session = await post('/api/widget/v1/sessions', null, { publicKey });
  if (!session.ok) throw new Error(`session ${String(session.status)}: ${await session.text()}`);
  const token = ((await session.json()) as { token: string }).token;
  const conversation = await post('/api/widget/v1/conversations', token, {});
  if (!conversation.ok) {
    throw new Error(`conversation ${String(conversation.status)}: ${await conversation.text()}`);
  }
  return { token, conversationId: ((await conversation.json()) as { id: string }).id };
}

async function oneTurn(visitor: Visitor): Promise<Sample> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, maxLatency);
  try {
    const response = await fetch(
      `${API_URL}/api/widget/v1/conversations/${visitor.conversationId}/messages`,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${visitor.token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ content: question }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`message ${String(response.status)}: ${await response.text()}`);
    }
    const ok = await firstDelta(response);
    return { ms: performance.now() - started, ok };
  } catch (error) {
    return { ms: performance.now() - started, ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const publicKey = await prepareMockBot();
  // Widget sessions are limited to 30/hour: create the 20 concurrent visitors first, then
  // pace each visitor to 17 messages/minute (the per-visitor limit is 20/minute).
  const visitors = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => createVisitor(publicKey)),
  );
  const deadline = performance.now() + DURATION_S * 1_000;
  const samples: Sample[] = [];
  let logged = 0;

  async function worker(visitor: Visitor): Promise<void> {
    while (performance.now() < deadline) {
      const turnStarted = performance.now();
      try {
        samples.push(await oneTurn(visitor));
      } catch (error) {
        samples.push({ ms: maxLatency, ok: false });
        if (logged < 5) {
          logged += 1;
          process.stderr.write(`ttft: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
      if (!samples.at(-1)?.ok && logged < 5) {
        logged += 1;
        const error = samples.at(-1)?.error;
        process.stderr.write(`ttft: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      const pause = 3_500 - (performance.now() - turnStarted);
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }

  await Promise.all(visitors.map(worker));

  const successful = samples.filter((sample) => sample.ok).map((sample) => sample.ms);
  const failed = samples.length - successful.length;
  const report = {
    target: 'p95 < 300 ms',
    durationSeconds: DURATION_S,
    concurrency: CONCURRENCY,
    requests: samples.length,
    failed,
    p50: percentile(successful, 50),
    p95: percentile(successful, 95),
    p99: percentile(successful, 99),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const output = process.env['PERF_OUTPUT'];
  if (output !== undefined) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (successful.length === 0 || report.p95 >= TARGET_P95_MS || failed > 0) process.exitCode = 1;
}

void main();
