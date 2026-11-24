// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable local/no-process-env -- perf harnesses are configured by the workflow */
/**
 * Outcomes report latency with 50,000 conversations across 92 UTC days.
 *
 *   DATABASE_URL=postgres://... pnpm --filter @app/api exec \
 *     node -r @swc-node/register test/perf/outcomes-latency.ts
 *
 * Seeds disposable rows, measures the repository-backed report, and removes the workspace.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

import { DataSource } from 'typeorm';

import { FixedClock } from '../../src/common/clock';
import { buildDataSourceOptions } from '../../src/db/data-source';
import { asWorkspaceId } from '../../src/db/ids';
import { OutcomesRepository } from '../../src/modules/usage/outcomes.repository';
import { OutcomesService } from '../../src/modules/usage/outcomes.service';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://app:app@localhost:5432/app';
const CONVERSATIONS = 50_000;
const SAMPLES = 20;
const TARGET_P95_MS = 300;

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
  let workspaceId = '';
  const now = new Date();
  const from = new Date(now.getTime() - 91 * 86_400_000);
  try {
    const workspace = await ds.query<{ id: string }[]>(
      `INSERT INTO workspaces (name, slug) VALUES ('Perf outcomes', $1) RETURNING id`,
      [`perf-outcomes-${String(Date.now())}`],
    );
    workspaceId = workspace[0]?.id ?? '';
    const credentials = await ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Outcomes chat'), ($1, 'mock', 'Outcomes embed') RETURNING id`,
      [workspaceId],
    );
    const bot = await ds.query<{ id: string }[]>(
      `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim)
       VALUES ($1, 'Outcomes perf', $2, $3, 'mock-chat', $4, 'mock-embed', 384) RETURNING id`,
      [
        workspaceId,
        `pk_perf_outcomes_${String(Date.now())}`,
        credentials[0]?.id,
        credentials[1]?.id,
      ],
    );
    const botId = bot[0]?.id ?? '';

    await ds.transaction(async (manager) => {
      await manager.query(`CREATE TEMP TABLE perf_outcomes_ids
      (n integer PRIMARY KEY, contact_id uuid NOT NULL, conversation_id uuid NOT NULL) ON COMMIT DROP`);
      await manager.query(
        `INSERT INTO perf_outcomes_ids (n, contact_id, conversation_id)
       SELECT n, uuidv7(), uuidv7() FROM generate_series(1, $1) n`,
        [CONVERSATIONS],
      );
      await manager.query(
        `INSERT INTO contacts (id, workspace_id, name)
       SELECT contact_id, $1::uuid, 'Perf visitor' FROM perf_outcomes_ids`,
        [workspaceId],
      );
      await manager.query(
        `INSERT INTO conversations
         (id, workspace_id, bot_id, contact_id, status, handoff_reason,
          handoff_requested_at, closed_at, created_at, last_message_at)
       SELECT ids.conversation_id, $1::uuid, $2::uuid, ids.contact_id,
              'closed'::conversation_status,
              CASE WHEN ids.n % 5 = 0 THEN 'visitor_request'::handoff_reason ELSE NULL END,
              CASE WHEN ids.n % 5 = 0
                THEN now() - ((ids.n % 92) || ' days')::interval + interval '1 hour'
                ELSE NULL END,
              now() - ((ids.n % 92) || ' days')::interval + interval '2 hours',
              now() - ((ids.n % 92) || ' days')::interval,
              now() - ((ids.n % 92) || ' days')::interval
         FROM perf_outcomes_ids ids`,
        [workspaceId, botId],
      );
      await manager.query(
        `INSERT INTO messages (workspace_id, conversation_id, role, content, created_at)
       SELECT $1::uuid, ids.conversation_id, 'visitor'::message_role, 'Question',
              now() - ((ids.n % 92) || ' days')::interval
         FROM perf_outcomes_ids ids
       UNION ALL
       SELECT $1::uuid, ids.conversation_id, 'ai'::message_role, 'Answer',
              now() - ((ids.n % 92) || ' days')::interval
         FROM perf_outcomes_ids ids`,
        [workspaceId],
      );
      await manager.query(
        `INSERT INTO messages (workspace_id, conversation_id, role, content, created_at)
       SELECT $1::uuid, ids.conversation_id, 'agent'::message_role, 'Reply',
              now() - ((ids.n % 92) || ' days')::interval + interval '90 minutes'
         FROM perf_outcomes_ids ids WHERE ids.n % 5 = 0`,
        [workspaceId],
      );
      await manager.query(
        `INSERT INTO generation_traces (workspace_id, bot_id, conversation_id, origin, decision, cost_usd)
       SELECT $1::uuid, $2::uuid, ids.conversation_id, 'widget'::trace_origin,
              'answered'::trace_decision, 0.000100
         FROM perf_outcomes_ids ids`,
        [workspaceId, botId],
      );
    });

    // Model a settled production dataset with visible index pages, not just ANALYZE's estimates.
    await ds.query('VACUUM (ANALYZE) conversations');
    await ds.query('VACUUM (ANALYZE) messages');
    await ds.query('VACUUM (ANALYZE) generation_traces');

    const service = new OutcomesService(new OutcomesRepository(ds), new FixedClock(now));
    const query = {
      from: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
      botId,
    };
    await Promise.all(
      Array.from({ length: 3 }, () => service.compute(asWorkspaceId(workspaceId), query)),
    );
    const samples: number[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now();
      await service.compute(asWorkspaceId(workspaceId), query);
      samples.push(performance.now() - started);
    }

    const p95 = percentile(samples, 95);
    const report = {
      target: `p95 < ${String(TARGET_P95_MS)} ms`,
      conversations: CONVERSATIONS,
      rangeDays: 92,
      samples: SAMPLES,
      p50Ms: Number(percentile(samples, 50).toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      p99Ms: Number(percentile(samples, 99).toFixed(2)),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const output = process.env['PERF_OUTPUT'];
    if (output !== undefined) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (p95 >= TARGET_P95_MS) process.exitCode = 1;
  } finally {
    if (workspaceId !== '') await ds.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await ds.destroy();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
