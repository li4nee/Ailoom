// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type { ConversationStatus, TraceDecision, TraceOrigin } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
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
  request_snapshot: Record<string, unknown> | null;
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
}

/** One row per answer attempt (spec §9.5); written by `ChatPersistence.finalize`. */
@Injectable()
export class TracesRepository extends TenantRepository<GenerationTraceEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(GenerationTraceEntity));
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
              t.embedding_provider, t.embedding_model, t.request_snapshot,
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
              left(ch.content, 200) AS preview
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

  private repositoryFor(manager?: EntityManager): Repository<GenerationTraceEntity> {
    return manager === undefined
      ? this.ds.getRepository(GenerationTraceEntity)
      : manager.getRepository(GenerationTraceEntity);
  }
}
