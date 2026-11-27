// SPDX-License-Identifier: AGPL-3.0-only
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { TRACE_DECISIONS, TRACE_ORIGINS, type TraceDecision, type TraceOrigin } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { BotEntity, PromptVersionEntity } from '../bots';
import { ConversationEntity, MessageEntity } from '../conversations';
import { WorkspaceEntity } from '../workspaces';

/** One retrieved candidate, as stored on the trace (spec §13.1). */
export interface TraceRetrievalEntry {
  chunk_id: string;
  score: number;
  rank: number;
  used: boolean;
  vector_rank?: number | null;
  keyword_rank?: number | null;
  fusion_score?: number;
  original_rank?: number;
  rerank_score?: number;
}

/**
 * One AI answer attempt, including escalations that skipped the LLM (spec §9.5). The
 * `(workspace_id|bot_id|decision, created_at)` indexes are hand-written, hence
 * `synchronize: false`.
 */
@Entity({ name: 'generation_traces' })
@Index('generation_traces_ws_created', { synchronize: false })
@Index('generation_traces_bot_created', { synchronize: false })
@Index('generation_traces_decision_created', { synchronize: false })
@Index('generation_traces_message_id_key', ['messageId'], { unique: true })
@Index('generation_traces_conversation_id', ['conversationId'])
@Index('generation_traces_trigger_message_id', ['triggerMessageId'])
@Index('generation_traces_prompt_version_id', ['promptVersionId'])
@Check('generation_traces_retrieval_mode_check', "\"retrieval_mode\" IN ('vector', 'hybrid')")
@Check(
  'generation_traces_model_routing_reason_check',
  `"model_routing_reason" IN ('primary', 'simple_question')`,
)
@Check(
  'generation_traces_reranking_failure_check',
  `"reranking_failure" IS NULL OR "reranking_failure" IN ('invalid_scores', 'unavailable', 'timeout')`,
)
@Check(
  'generation_traces_query_rewriting_failure_check',
  `"query_rewriting_failure" IS NULL OR "query_rewriting_failure" IN ('invalid_output', 'unavailable', 'timeout')`,
)
@Check(
  'generation_traces_answer_verification_status_check',
  `"answer_verification_status" IS NULL OR "answer_verification_status" IN ('supported', 'unsupported', 'unavailable', 'invalid_output', 'timeout')`,
)
export class GenerationTraceEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'generation_traces_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'generation_traces_bot_id_fkey' })
  bot!: BotEntity;

  /** Null for playground runs. */
  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  // SET NULL: a trace carries token cost that the usage page sums, so deleting a conversation
  // must not erase it.
  @ManyToOne(() => ConversationEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'generation_traces_conversation_id_fkey',
  })
  conversation!: ConversationEntity | null;

  /** The AI message produced; null for playground runs. */
  @Column({ type: 'uuid', nullable: true })
  messageId!: string | null;

  @ManyToOne(() => MessageEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'message_id',
    foreignKeyConstraintName: 'generation_traces_message_id_fkey',
  })
  message!: MessageEntity | null;

  /** Playground traces are excluded from conversation counts but included in cost. */
  @Column({ type: 'enum', enum: TRACE_ORIGINS, enumName: 'trace_origin' })
  origin!: TraceOrigin;

  /** The visitor message answered. */
  @Column({ type: 'uuid', nullable: true })
  triggerMessageId!: string | null;

  @ManyToOne(() => MessageEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'trigger_message_id',
    foreignKeyConstraintName: 'generation_traces_trigger_message_id_fkey',
  })
  triggerMessage!: MessageEntity | null;

  @Column({ type: 'uuid', nullable: true })
  promptVersionId!: string | null;

  @ManyToOne(() => PromptVersionEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'prompt_version_id',
    foreignKeyConstraintName: 'generation_traces_prompt_version_id_fkey',
  })
  promptVersion!: PromptVersionEntity | null;

  /** Version of the fixed platform prompt used (spec §15.1); playground traces carry it too. */
  @Column({ type: 'text', nullable: true })
  platformPromptVersion!: string | null;

  @Column({ type: 'text', nullable: true })
  chatProvider!: string | null;

  @Column({ type: 'text', nullable: true })
  chatModel!: string | null;

  @Column({ type: 'text', default: 'primary' })
  modelRoutingReason!: 'primary' | 'simple_question';

  @Column({ type: 'text', nullable: true })
  embeddingProvider!: string | null;

  @Column({ type: 'text', nullable: true })
  embeddingModel!: string | null;

  /** Top K candidates, including those below the threshold. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  retrieval!: TraceRetrievalEntry[];

  @Column({ type: 'text', default: 'vector' })
  retrievalMode!: 'vector' | 'hybrid';

  @Column({ type: 'int', nullable: true })
  retrievalMs!: number | null;

  @Column({ type: 'boolean', default: false })
  rerankingApplied!: boolean;

  @Column({ type: 'int', default: 0 })
  rerankingMs!: number;

  @Column({ type: 'text', nullable: true })
  rerankingFailure!: 'invalid_scores' | 'unavailable' | 'timeout' | null;

  @Column({ type: 'boolean', default: false })
  queryRewritingApplied!: boolean;

  @Column({ type: 'int', default: 0 })
  queryRewritingMs!: number;

  @Column({ type: 'text', nullable: true })
  queryRewritingFailure!: 'invalid_output' | 'unavailable' | 'timeout' | null;

  @Column({ type: 'text', nullable: true })
  answerVerificationStatus!:
    'supported' | 'unsupported' | 'unavailable' | 'invalid_output' | 'timeout' | null;

  @Column({ type: 'int', default: 0 })
  answerVerificationMs!: number;

  @Column({ type: 'numeric', precision: 12, scale: 6, nullable: true })
  retrievalCostUsd!: string | null;

  @Column({ type: 'real', nullable: true })
  topScore!: number | null;

  @Column({ type: 'enum', enum: TRACE_DECISIONS, enumName: 'trace_decision' })
  decision!: TraceDecision;

  /** e.g. `top_score_below_threshold`. */
  @Column({ type: 'text', nullable: true })
  decisionReason!: string | null;

  /** What the model received, size-capped at 64 KB; never contains API keys. */
  @Column({ type: 'jsonb', nullable: true })
  requestSnapshot!: Record<string, unknown> | null;

  /** Phase 3. */
  @Column({ type: 'jsonb', nullable: true })
  toolCalls!: unknown[] | null;

  @Column({ type: 'int', default: 0 })
  inputTokens!: number;

  @Column({ type: 'int', default: 0 })
  outputTokens!: number;

  @Column({ type: 'int', default: 0 })
  embeddingTokens!: number;

  /** Computed at write time from the price table. numeric: returned as a string. */
  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: 'int', nullable: true })
  latencyMs!: number | null;

  @Column({ type: 'int', nullable: true })
  ttftMs!: number | null;

  /** Redacted provider error. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
