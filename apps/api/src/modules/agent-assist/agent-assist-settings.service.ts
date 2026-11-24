// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';

@Injectable()
export class AgentAssistSettingsService {
  constructor(private readonly ds: DataSource) {}

  async operationsDiagnostics(workspaceId: WorkspaceId): Promise<{
    windowHours: 24;
    modes: {
      botId: string;
      botName: string;
      summariesEnabled: boolean;
      suggestionsEnabled: boolean;
      chatCredential: 'missing' | 'configured' | 'previously_failed';
      chatModel: string;
      embeddingCredential: 'missing' | 'configured' | 'previously_failed';
      embeddingModel: string;
    }[];
    metrics: {
      kind: 'handoff_summary' | 'suggested_reply';
      provider: string;
      model: string;
      promptVersion: string;
      runs: number;
      succeeded: number;
      errors: number;
      spendCap: number;
      rateLimited: number;
      queueLatencyMs: number;
      providerLatencyMs: number;
      inputTokens: number;
      outputTokens: number;
      embeddingTokens: number;
      costUsd: string;
    }[];
  }> {
    const modes = await this.ds.query<
      {
        botId: string;
        botName: string;
        summariesEnabled: boolean;
        suggestionsEnabled: boolean;
        chatCredential: 'missing' | 'configured' | 'previously_failed';
        chatModel: string;
        embeddingCredential: 'missing' | 'configured' | 'previously_failed';
        embeddingModel: string;
      }[]
    >(
      `SELECT b.id AS "botId", b.name AS "botName",
              (b.agent_assist_enabled AND b.automatic_handoff_summaries AND b.deleted_at IS NULL) AS "summariesEnabled",
              (b.agent_assist_enabled AND b.suggested_replies_enabled AND b.deleted_at IS NULL) AS "suggestionsEnabled",
              CASE WHEN cc.id IS NULL THEN 'missing' WHEN cc.last_error_at IS NOT NULL THEN 'previously_failed' ELSE 'configured' END AS "chatCredential",
              b.chat_model AS "chatModel",
              CASE WHEN ec.id IS NULL THEN 'missing' WHEN ec.last_error_at IS NOT NULL THEN 'previously_failed' ELSE 'configured' END AS "embeddingCredential",
              b.embedding_model AS "embeddingModel"
         FROM bots b
         LEFT JOIN provider_credentials cc ON cc.workspace_id = b.workspace_id AND cc.id = b.chat_credential_id
         LEFT JOIN provider_credentials ec ON ec.workspace_id = b.workspace_id AND ec.id = b.embedding_credential_id
        WHERE b.workspace_id = $1 AND b.deleted_at IS NULL ORDER BY b.name, b.id`,
      [workspaceId],
    );
    const metrics = await this.ds.query<
      {
        kind: 'handoff_summary' | 'suggested_reply';
        provider: string;
        model: string;
        promptVersion: string;
        runs: number;
        succeeded: number;
        errors: number;
        spendCap: number;
        rateLimited: number;
        queueLatencyMs: number;
        providerLatencyMs: number;
        inputTokens: number;
        outputTokens: number;
        embeddingTokens: number;
        costUsd: string;
      }[]
    >(
      `SELECT a.kind AS kind, COALESCE(t.chat_provider, 'unknown') AS provider,
              COALESCE(t.chat_model, 'unknown') AS model, a.prompt_version AS "promptVersion",
              count(*)::int AS runs,
              count(*) FILTER (WHERE a.state = 'ready')::int AS succeeded,
              count(*) FILTER (WHERE a.state = 'failed' AND a.error NOT IN ('spend_cap_reached', 'rate_limited'))::int AS errors,
              count(*) FILTER (WHERE a.error = 'spend_cap_reached' OR t.decision_reason = 'spend_cap_reached')::int AS "spendCap",
              count(*) FILTER (WHERE a.error = 'rate_limited' OR t.decision_reason = 'rate_limited')::int AS "rateLimited",
              COALESCE(avg(GREATEST(0, EXTRACT(epoch FROM (t.created_at - a.created_at)) * 1000 - COALESCE(t.latency_ms, 0))) FILTER (WHERE t.id IS NOT NULL), 0)::int AS "queueLatencyMs",
              COALESCE(avg(t.latency_ms), 0)::int AS "providerLatencyMs",
              COALESCE(sum(t.input_tokens), 0)::int AS "inputTokens",
              COALESCE(sum(t.output_tokens), 0)::int AS "outputTokens",
              COALESCE(sum(t.embedding_tokens), 0)::int AS "embeddingTokens",
              COALESCE(sum(t.cost_usd), 0)::text AS "costUsd"
         FROM conversation_ai_artifacts a
         LEFT JOIN generation_traces t ON t.workspace_id = a.workspace_id AND t.id = a.trace_id
        WHERE a.workspace_id = $1 AND a.created_at >= now() - interval '24 hours'
        GROUP BY a.kind, provider, model, a.prompt_version ORDER BY a.kind, provider, model`,
      [workspaceId],
    );
    return { windowHours: 24, modes, metrics };
  }

  async summaryEnabled(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    const rows = await this.ds.query<{ enabled: boolean }[]>(
      `SELECT (agent_assist_enabled AND automatic_handoff_summaries AND deleted_at IS NULL) AS enabled
         FROM bots WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, botId],
    );
    return rows[0]?.enabled ?? false;
  }

  async suggestedRepliesEnabled(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    const rows = await this.ds.query<{ enabled: boolean }[]>(
      `SELECT (agent_assist_enabled AND suggested_replies_enabled AND deleted_at IS NULL) AS enabled
         FROM bots WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, botId],
    );
    return rows[0]?.enabled ?? false;
  }
}
