// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable local/no-process-env -- the isolated perf workflow is configured by its runner */
/**
 * Inbox read and agent mutation latency under 20 concurrent clients.
 * Run against the perf overlay after the current schema and demo seed are installed.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Client } from 'pg';

import { PasswordHasher } from '../../src/modules/auth/password-hasher';

const API_URL = process.env['API_URL'] ?? 'http://localhost:13000';
const APP_ORIGIN = process.env['PUBLIC_URL'] ?? 'http://localhost:18090';
const DATABASE_URL = process.env['DATABASE_URL'];
const CONCURRENCY = Number(process.env['PERF_CONCURRENCY'] ?? 20);
const ROWS = Number(process.env['PERF_ROWS'] ?? 1_000);
const DURATION_S = Number(process.env['PERF_DURATION_S'] ?? 30);
const THINK_TIME_MS = Number(process.env['PERF_THINK_TIME_MS'] ?? 1_000);
const REVISION = process.env['PERF_REVISION'] ?? 'local';
const MODE = process.env['BENCH_MODE'] ?? 'm9';

interface Sample {
  ms: number;
  ok: boolean;
  error?: string;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN
  );
}

function summarize(samples: Sample[]) {
  const successful = samples.filter((sample) => sample.ok).map((sample) => sample.ms);
  return {
    requests: samples.length,
    failed: samples.length - successful.length,
    p50Ms: Number(percentile(successful, 50).toFixed(2)),
    p95Ms: Number(percentile(successful, 95).toFixed(2)),
    p99Ms: Number(percentile(successful, 99).toFixed(2)),
    throughputPerSecond: Number((samples.length / DURATION_S).toFixed(2)),
  };
}

async function main(): Promise<void> {
  if (DATABASE_URL === undefined) throw new Error('DATABASE_URL is required');
  if (MODE !== 'm8' && MODE !== 'm9') throw new Error('BENCH_MODE must be m8 or m9');

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
  const ownerHeaders = {
    Cookie: cookie,
    Origin: APP_ORIGIN,
    'X-Requested-With': 'fetch',
    'Content-Type': 'application/json',
  };
  const workspaceResponse = await fetch(`${API_URL}/api/v1/workspaces`, {
    headers: ownerHeaders,
  });
  if (!workspaceResponse.ok) throw new Error(`workspaces: ${await workspaceResponse.text()}`);
  const workspaces = (await workspaceResponse.json()) as { id: string }[];
  const workspaceId = workspaces[0]?.id;
  if (workspaceId === undefined) throw new Error('perf setup: no workspace');

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const prefix = `perf-inbox-${randomUUID()}-`;
  let botId: string;
  let agentIds: string[];
  let conversationIds: string[];
  try {
    const botResult = await db.query<{ id: string }>(
      `SELECT id FROM bots WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`,
      [workspaceId],
    );
    const bot = botResult.rows[0];
    if (bot === undefined) throw new Error('perf setup: bot missing');
    botId = bot.id;

    const passwordHash = await new PasswordHasher().hash('InboxBenchmarkOnly!');
    const agents = await db.query<{ id: string; email: string }>(
      `WITH generated AS (
         SELECT value, $1::text || 'agent-' || value::text || '@example.test' AS email
           FROM generate_series(1, $3::int) AS value
       )
       INSERT INTO users (email, password_hash, name, email_verified_at)
       SELECT email, $2, 'Inbox benchmark agent', now() FROM generated
       RETURNING id, email`,
      [prefix, passwordHash, CONCURRENCY],
    );
    agentIds = agents.rows
      .sort((left, right) => {
        const leftIndex = Number(/agent-(\d+)@/.exec(left.email)?.[1] ?? 0);
        const rightIndex = Number(/agent-(\d+)@/.exec(right.email)?.[1] ?? 0);
        return leftIndex - rightIndex;
      })
      .map((agent) => agent.id);
    await db.query(
      `INSERT INTO memberships (workspace_id, user_id, role)
       SELECT $1, agent_id, 'agent' FROM unnest($2::uuid[]) AS agent_id`,
      [workspaceId, agentIds],
    );

    await db.query(
      `WITH generated AS (
         SELECT value, $2::text || lpad(value::text, 5, '0') AS external_id
           FROM generate_series(1, $3::int) AS value
       ), inserted_contacts AS (
         INSERT INTO contacts (workspace_id, external_id, name, email)
         SELECT $1, external_id, 'Inbox benchmark contact', external_id || '@example.test'
           FROM generated
         RETURNING id, external_id
       ), inserted_conversations AS (
         INSERT INTO conversations
           (workspace_id, bot_id, contact_id, status, handoff_reason,
            handoff_requested_at, priority, last_message_at)
         SELECT $1, $4, contact.id,
                CASE
                  WHEN right(contact.external_id, 5)::int <= 20 THEN 'needs_human'::conversation_status
                  WHEN right(contact.external_id, 5)::int % 10 < 2 THEN 'needs_human'::conversation_status
                  WHEN right(contact.external_id, 5)::int % 10 < 8 THEN 'human'::conversation_status
                  ELSE 'closed'::conversation_status
                END,
                'visitor_request', now(),
                CASE (right(contact.external_id, 5)::int % 4)
                  WHEN 0 THEN 'urgent'::priority
                  WHEN 1 THEN 'high'::priority
                  WHEN 2 THEN 'normal'::priority
                  ELSE 'low'::priority
                END,
                now() - right(contact.external_id, 5)::int * interval '1 second'
           FROM inserted_contacts contact
         RETURNING id, workspace_id, contact_id, last_message_at
       )
       INSERT INTO messages (workspace_id, conversation_id, role, content, status, created_at)
       SELECT conversation.workspace_id, conversation.id, 'visitor',
              'Inbox benchmark message', 'complete', conversation.last_message_at
         FROM inserted_conversations conversation`,
      [workspaceId, prefix, ROWS, botId],
    );
    await db.query('ANALYZE conversations');
    await db.query('ANALYZE contacts');
    await db.query('ANALYZE messages');
    const conversations = await db.query<{ id: string }>(
      `SELECT c.id
         FROM conversations c
         JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
        WHERE c.workspace_id = $1 AND ct.external_id LIKE $2 AND c.status = 'needs_human'
        ORDER BY ct.external_id
        LIMIT $3`,
      [workspaceId, `${prefix}%`, CONCURRENCY],
    );
    conversationIds = conversations.rows.map((row) => row.id);
    if (conversationIds.length !== CONCURRENCY) {
      throw new Error(`perf setup: expected ${String(CONCURRENCY)} conversations`);
    }
  } finally {
    await db.end();
  }

  const agentHeaders: (typeof ownerHeaders)[] = [];
  for (let index = 0; index < CONCURRENCY; index += 1) {
    const email = `${prefix}agent-${String(index + 1)}@example.test`;
    const agentLogin = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
        Origin: APP_ORIGIN,
      },
      body: JSON.stringify({ email, password: 'InboxBenchmarkOnly!' }),
    });
    if (!agentLogin.ok) {
      throw new Error(`agent login ${String(agentLogin.status)} for client ${String(index + 1)}`);
    }
    const agentCookie = agentLogin.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    agentHeaders.push({ ...ownerHeaders, Cookie: agentCookie });
  }
  const headersFor = (worker: number) => {
    const headers = agentHeaders[worker];
    if (headers === undefined) throw new Error(`missing agent client ${String(worker)}`);
    return headers;
  };

  const listUrl = `${API_URL}/api/v1/workspaces/${workspaceId}/conversations?status=needs_human&limit=50`;
  const runPhase = async (
    name: string,
    operation: (worker: number, iteration: number) => Promise<{ ok: boolean; error?: string }>,
  ): Promise<Record<string, unknown>> => {
    const samples: Sample[] = [];
    const errors: Record<string, number> = {};
    const deadline = performance.now() + DURATION_S * 1_000;
    const phaseStarted = performance.now();
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, worker) => {
        let iteration = 0;
        while (performance.now() < deadline) {
          const started = performance.now();
          const result = await operation(worker, iteration).catch((error: unknown) => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
          samples.push({ ms: performance.now() - started, ...result });
          if (result.error !== undefined) errors[result.error] = (errors[result.error] ?? 0) + 1;
          iteration += 1;
          if (THINK_TIME_MS > 0) {
            await new Promise((resolve) => setTimeout(resolve, THINK_TIME_MS));
          }
        }
      }),
    );
    const elapsedSeconds = (performance.now() - phaseStarted) / 1_000;
    const summary = summarize(samples);
    summary.throughputPerSecond = Number((samples.length / elapsedSeconds).toFixed(2));
    return { phase: name, elapsedSeconds: Number(elapsedSeconds.toFixed(2)), ...summary, errors };
  };

  const inbox = await runPhase('inbox-list', async (worker) => {
    const response = await fetch(listUrl, { headers: headersFor(worker) });
    if (!response.ok) return { ok: false, error: `http-${String(response.status)}` };
    await response.arrayBuffer();
    return { ok: true };
  });

  const phases: Record<string, unknown>[] = [inbox];
  if (MODE === 'm9') {
    const versions = Array.from({ length: CONCURRENCY }, () => 1);
    const priorities = Array.from({ length: CONCURRENCY }, () => 'normal');
    const assigned = Array.from({ length: CONCURRENCY }, () => false);
    phases.push(
      await runPhase('priority-mutation', async (worker) => {
        const nextPriority = priorities[worker] === 'high' ? 'normal' : 'high';
        const conversationId = conversationIds[worker];
        if (conversationId === undefined) throw new Error(`missing conversation ${String(worker)}`);
        const response = await fetch(
          `${API_URL}/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/priority`,
          {
            method: 'PATCH',
            headers: headersFor(worker),
            body: JSON.stringify({
              priority: nextPriority,
              expectedWorkflowVersion: versions[worker],
              mutationId: randomUUID(),
            }),
          },
        );
        if (!response.ok) return { ok: false, error: `http-${String(response.status)}` };
        const body = (await response.json()) as { workflowVersion: number };
        versions[worker] = body.workflowVersion;
        priorities[worker] = nextPriority;
        return { ok: true };
      }),
      await runPhase('assignment-mutation', async (worker) => {
        const conversationId = conversationIds[worker];
        if (conversationId === undefined) throw new Error(`missing conversation ${String(worker)}`);
        const assignedUserId = assigned[worker] ? null : agentIds[worker];
        const response = await fetch(
          `${API_URL}/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/assignment`,
          {
            method: 'PATCH',
            headers: headersFor(worker),
            body: JSON.stringify({
              assignedUserId,
              expectedWorkflowVersion: versions[worker],
              mutationId: randomUUID(),
            }),
          },
        );
        if (!response.ok) return { ok: false, error: `http-${String(response.status)}` };
        const body = (await response.json()) as { workflowVersion: number };
        versions[worker] = body.workflowVersion;
        assigned[worker] = !assigned[worker];
        return { ok: true };
      }),
    );
  }

  const report = {
    revision: REVISION,
    mode: MODE,
    rows: ROWS,
    concurrency: CONCURRENCY,
    durationSecondsPerPhase: DURATION_S,
    thinkTimeMsPerAgent: THINK_TIME_MS,
    phases,
    thresholds: {
      inboxP95RegressionMaxPercent: 10,
      assignmentP95MaxMs: 300,
      priorityP95MaxMs: 300,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const output = process.env['PERF_OUTPUT'];
  if (output !== undefined) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (phases.some((phase) => phase['failed'] !== 0)) process.exitCode = 1;
}

void main();
