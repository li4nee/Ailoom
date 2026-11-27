// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type { ConversationStatus, TraceDecision, TraceOrigin } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { isUuid } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { GenerationTraceEntity } from './generation-trace.entity';

/** A trace joined with the prompt version and the feedback on its AI message. */
export interface TraceDetailRow {
  id: string;
  decision: TraceDecision;
  decision_reason: string | null;
  origin: TraceOrigin;
  created_at: Date;
  prompt_version_id: string | null;
  prompt_version_number: number | null;
  prompt_system_prompt: string | null;
  platform_prompt_version: string | null;
  chat_provider: string | null;
  chat_model: string | null;
  embedding_provider: string | null;
  embedding_model: string | null;
  retrieval_mode: 'vector' | 'hybrid';
  retrieval_ms: number | null;
  reranking_applied: boolean;
  reranking_ms: number;
  reranking_failure: 'invalid_scores' | 'unavailable' | 'timeout' | null;
  query_rewriting_applied: boolean;
  query_rewriting_ms: number;
  query_rewriting_failure: 'invalid_output' | 'unavailable' | 'timeout' | null;
  answer_verification_status:
    'supported' | 'unsupported' | 'unavailable' | 'invalid_output' | 'timeout' | null;
  answer_verification_ms: number;
  retrieval_cost_usd: string | null;
  request_snapshot: Record<string, unknown> | null;
  tool_calls:
    | {
        name: string;
        inputFields: string[];
        outputFields: string[];
        status: 'started' | 'complete' | 'failed';
        durationMs: number | null;
      }[]
    | null;
  input_tokens: number;
  output_tokens: number;
  embedding_tokens: number;
  cost_usd: string;
  latency_ms: number | null;
  ttft_ms: number | null;
  error: string | null;
  feedback: number | null;
  conversation_status: ConversationStatus | null;
}

/** One stored retrieval entry joined to the chunk and source it pointed at. */
export interface TraceRetrievalRowRaw {
  rank: number;
  score: number;
  used: boolean;
  chunk_id: string;
  document_id: string | null;
  source_title: string | null;
  preview: string | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  fusion_score: number | null;
  original_rank?: number | null;
  rerank_score?: number | null;
}

export interface UnansweredRow {
  message_id: string;
  conversation_id: string;
  bot_id: string;
  content: string;
  top_score: number | null;
  created_at: Date;
}

export interface FeedbackRow {
  message_id: string;
  conversation_id: string;
  content: string;
  trace_id: string | null;
  feedback_at: Date | null;
}

export interface KnowledgeGapRow {
  bot_id: string;
  bot_name: string;
  wording: string;
  occurrences: number;
  conversations: number;
  last_seen: Date;
  daily: { day: string; count: number }[];
  examples: { message_id: string; conversation_id: string; content: string; created_at: Date }[];
}

export interface KnowledgeGapTotals {
  total_messages: number;
  total_groups: number;
}

/** One row per answer attempt (spec §9.5); written by `ChatPersistence.finalize`. */
@Injectable()
export class TracesRepository extends TenantRepository<GenerationTraceEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(GenerationTraceEntity));
  }

  async assertBot(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    const rows = await this.ds.query<{ present: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM bots WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL) AS present`,
      [workspaceId, botId],
    );
    return rows[0]?.present ?? false;
  }

  /** The trace of one AI message, or null for a message that never got one. */
  async findByMessageId(
    workspaceId: WorkspaceId,
    messageId: string,
    manager?: EntityManager,
  ): Promise<GenerationTraceEntity | null> {
    return this.repositoryFor(manager).findOne({ where: { workspaceId, messageId } });
  }

  /**
   * The replay view of one trace (spec §17.8). Raw SQL because the prompt version and the
   * message feedback live in other modules, and the retrieval entries are a jsonb array whose
   * order must be preserved with `WITH ORDINALITY`.
   */
  async detail(workspaceId: WorkspaceId, id: string): Promise<TraceDetailRow | null> {
    const rows = await this.ds.query<TraceDetailRow[]>(
      `SELECT t.id, t.decision, t.decision_reason, t.origin, t.created_at,
              t.prompt_version_id, pv.version AS prompt_version_number,
              pv.system_prompt AS prompt_system_prompt,
              t.platform_prompt_version, t.chat_provider, t.chat_model,
              t.embedding_provider, t.embedding_model, t.retrieval_mode, t.retrieval_ms,
              t.reranking_applied, t.reranking_ms, t.reranking_failure,
              t.query_rewriting_applied, t.query_rewriting_ms, t.query_rewriting_failure,
              t.answer_verification_status, t.answer_verification_ms,
              t.retrieval_cost_usd, t.request_snapshot,
              COALESCE(
                (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'name', ti.name,
                  'remoteName', CASE WHEN btv.definition->>'transport' = 'mcp'
                                     THEN btv.definition->>'remoteToolName' END,
                  'toolVersion', ti.tool_version,
                  'inputFields', ti.input_fields,
                  'outputFields', ti.output_fields,
                  'status', ti.status,
                  'durationMs', ti.duration_ms
                )) ORDER BY ti.started_at)
                 FROM tool_invocations ti
                 LEFT JOIN bot_tool_versions btv
                   ON btv.workspace_id = ti.workspace_id
                  AND btv.tool_id = ti.tool_id
                  AND btv.version = ti.tool_version
                WHERE ti.workspace_id = t.workspace_id AND ti.trace_id = t.id),
                t.tool_calls
              ) AS tool_calls,
              t.input_tokens, t.output_tokens, t.embedding_tokens, t.cost_usd,
              t.latency_ms, t.ttft_ms, t.error, m.feedback,
              c.status AS conversation_status
         FROM generation_traces t
         LEFT JOIN prompt_versions pv ON pv.id = t.prompt_version_id
         LEFT JOIN messages m ON m.id = t.message_id
         LEFT JOIN conversations c ON c.id = t.conversation_id
        WHERE t.workspace_id = $1 AND t.id = $2`,
      [workspaceId, id],
    );
    return rows[0] ?? null;
  }

  /**
   * Retrieval rows in their stored order. Missing chunks (deleted document/source) keep their
   * trace entry and come back with null source fields, so the replay still renders.
   */
  async retrievalRows(workspaceId: WorkspaceId, id: string): Promise<TraceRetrievalRowRaw[]> {
    return this.ds.query<TraceRetrievalRowRaw[]>(
      `SELECT (entry->>'rank')::int AS rank,
              (entry->>'score')::real AS score,
              (entry->>'used')::boolean AS used,
              entry->>'chunk_id' AS chunk_id,
              d.id AS document_id,
              COALESCE(d.title, s.title) AS source_title,
              left(ch.content, 200) AS preview,
              (entry->>'vector_rank')::int AS vector_rank,
              (entry->>'keyword_rank')::int AS keyword_rank,
              (entry->>'fusion_score')::real AS fusion_score,
              (entry->>'original_rank')::int AS original_rank,
              (entry->>'rerank_score')::real AS rerank_score
         FROM generation_traces t
         CROSS JOIN LATERAL jsonb_array_elements(t.retrieval) WITH ORDINALITY AS r(entry, ord)
         LEFT JOIN chunks ch ON ch.id = (entry->>'chunk_id')::uuid
                            AND ch.workspace_id = t.workspace_id
         LEFT JOIN document_versions dv ON dv.id = ch.document_version_id
         LEFT JOIN documents d ON d.id = dv.document_id
         LEFT JOIN knowledge_sources s ON s.id = d.source_id
        WHERE t.workspace_id = $1 AND t.id = $2
        ORDER BY r.ord`,
      [workspaceId, id],
    );
  }

  /**
   * Recent unanswered visitor questions (spec §17.10): escalations for missing knowledge, not
   * handoff intent and not playground runs. Page order is newest first.
   */
  async unanswered(
    workspaceId: WorkspaceId,
    options: { botId: string | undefined; cursor: string | undefined; limit: number },
  ): Promise<{ data: UnansweredRow[]; nextCursor: string | null }> {
    this.assertCursor(options.cursor);
    const rows = await this.ds.query<UnansweredRow[]>(
      `SELECT m.id AS message_id, m.conversation_id, t.bot_id, m.content, t.top_score,
              m.created_at
         FROM messages m
         JOIN generation_traces t ON t.trigger_message_id = m.id
                                AND t.workspace_id = m.workspace_id
        WHERE m.workspace_id = $1
          AND t.origin = 'widget'
          AND t.decision = 'escalated'
          AND t.decision_reason IN ('top_score_below_threshold', 'no_knowledge')
          AND ($2::uuid IS NULL OR t.bot_id = $2)
          AND ($3::uuid IS NULL OR m.id < $3)
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $4`,
      [workspaceId, options.botId ?? null, options.cursor ?? null, options.limit + 1],
    );
    const data = rows.slice(0, options.limit);
    return {
      data,
      nextCursor: rows.length > options.limit ? (data.at(-1)?.message_id ?? null) : null,
    };
  }

  /** Repeated low/no-retrieval widget questions, grouped on normalized wording per bot. */
  async knowledgeGaps(
    workspaceId: WorkspaceId,
    from: Date,
    toExclusive: Date,
    botId: string | undefined,
  ): Promise<{ groups: KnowledgeGapRow[]; total: KnowledgeGapTotals }> {
    const params = [workspaceId, from, toExclusive, botId ?? null];
    const eligible = `SELECT DISTINCT ON (m.id)
                m.id AS message_id, m.conversation_id, t.bot_id, b.name AS bot_name,
                m.content, m.created_at,
                COALESCE(NULLIF(lower(trim(regexp_replace(regexp_replace(trim(m.content), '\\s+', ' ', 'g'), '\\?+$', ''))), ''), trim(m.content)) AS wording
           FROM messages m
           JOIN generation_traces t ON t.trigger_message_id = m.id AND t.workspace_id = m.workspace_id
           JOIN bots b ON b.id = t.bot_id AND b.workspace_id = t.workspace_id
          WHERE m.workspace_id = $1 AND t.workspace_id = $1
            AND t.origin = 'widget' AND t.decision = 'escalated'
            AND t.decision_reason IN ('top_score_below_threshold', 'no_knowledge')
            AND m.created_at >= $2 AND m.created_at < $3
            AND ($4::uuid IS NULL OR t.bot_id = $4)
          ORDER BY m.id, t.created_at DESC`;
    const totals = await this.ds.query<KnowledgeGapTotals[]>(
      `WITH eligible AS (${eligible}), grouped AS (
         SELECT bot_id, wording, count(*) AS occurrences FROM eligible GROUP BY bot_id, wording
       ) SELECT COALESCE(sum(occurrences), 0)::int AS total_messages,
                count(*)::int AS total_groups FROM grouped`,
      params,
    );
    const rows = await this.ds.query<KnowledgeGapRow[]>(
      `WITH eligible AS (${eligible}), grouped AS (
         SELECT bot_id, bot_name, wording, count(*)::int AS occurrences,
                count(DISTINCT conversation_id)::int AS conversations, max(created_at) AS last_seen
           FROM eligible GROUP BY bot_id, bot_name, wording
       ), top_groups AS (
         SELECT * FROM grouped
          ORDER BY occurrences DESC, last_seen DESC, wording ASC, bot_id ASC
          LIMIT 50
       ), daily_counts AS (
         SELECT e.bot_id, e.wording, date_trunc('day', e.created_at) AS day, count(*)::int AS count
           FROM eligible e JOIN top_groups g USING (bot_id, wording)
          GROUP BY e.bot_id, e.wording, date_trunc('day', e.created_at)
       ), daily AS (
         SELECT bot_id, wording,
                jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'count', count) ORDER BY day) AS daily
           FROM daily_counts GROUP BY bot_id, wording
       ), recent_ranked AS (
         SELECT e.bot_id, e.wording, e.message_id, e.conversation_id,
                left(e.content, 500) AS content, e.created_at,
                row_number() OVER (PARTITION BY e.bot_id, e.wording ORDER BY e.created_at DESC, e.message_id DESC) AS position
           FROM eligible e JOIN top_groups g USING (bot_id, wording)
       ), recent AS (
         SELECT bot_id, wording,
                jsonb_agg(jsonb_build_object('message_id', message_id, 'conversation_id', conversation_id,
                         'content', content, 'created_at', created_at) ORDER BY created_at DESC, message_id DESC)
                  FILTER (WHERE position <= 3) AS examples
           FROM recent_ranked GROUP BY bot_id, wording
       ) SELECT g.bot_id, g.bot_name, g.wording, g.occurrences, g.conversations, g.last_seen,
                d.daily, r.examples
           FROM top_groups g JOIN daily d USING (bot_id, wording) JOIN recent r USING (bot_id, wording)
          ORDER BY g.occurrences DESC, g.last_seen DESC, g.wording ASC, g.bot_id ASC`,
      params,
    );
    return { groups: rows, total: totals[0] ?? { total_messages: 0, total_groups: 0 } };
  }

  /** AI answers with one thumbs rating, newest feedback first. */
  async feedback(
    workspaceId: WorkspaceId,
    options: {
      rating: 1 | -1;
      botId: string | undefined;
      cursor: string | undefined;
      limit: number;
    },
  ): Promise<{ data: FeedbackRow[]; nextCursor: string | null }> {
    this.assertCursor(options.cursor);
    const rows = await this.ds.query<FeedbackRow[]>(
      `SELECT m.id AS message_id, m.conversation_id, m.content, t.id AS trace_id,
              m.feedback_at
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN generation_traces t ON t.message_id = m.id
                                     AND t.workspace_id = m.workspace_id
        WHERE m.workspace_id = $1
          AND m.role = 'ai'
          AND m.feedback = $2
          AND ($3::uuid IS NULL OR c.bot_id = $3)
          AND ($4::uuid IS NULL OR m.id < $4)
        ORDER BY m.feedback_at DESC NULLS LAST, m.id DESC
        LIMIT $5`,
      [
        workspaceId,
        options.rating,
        options.botId ?? null,
        options.cursor ?? null,
        options.limit + 1,
      ],
    );
    const data = rows.slice(0, options.limit);
    return {
      data,
      nextCursor: rows.length > options.limit ? (data.at(-1)?.message_id ?? null) : null,
    };
  }

  private assertCursor(cursor: string | undefined): void {
    if (cursor !== undefined && !isUuid(cursor)) throw new AppError('validation_failed');
  }

  /** Hard-deletes traces older than `cutoff`. Returns the number of rows removed. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.ds
      .createQueryBuilder()
      .delete()
      .from(GenerationTraceEntity)
      .where('created_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  private repositoryFor(manager?: EntityManager): Repository<GenerationTraceEntity> {
    return manager === undefined
      ? this.ds.getRepository(GenerationTraceEntity)
      : manager.getRepository(GenerationTraceEntity);
  }
}
