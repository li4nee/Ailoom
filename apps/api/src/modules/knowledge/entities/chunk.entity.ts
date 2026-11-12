// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { BotEntity } from '../../bots';
import { WorkspaceEntity } from '../../workspaces';
import { DocumentVersionEntity } from './document-version.entity';

/**
 * A retrievable piece of a document version (spec §9.3, §12.6).
 *
 * `embedding` is an untyped pgvector column; each row records its own `embedding_dim`, and
 * one partial HNSW expression index per supported dimension serves the retrieval query. Those
 * indexes and the GIN index on `tsv` live in a hand-written migration (CONCURRENTLY, expression
 * indexes), so they are declared here with `synchronize: false`.
 */
@Entity({ name: 'chunks' })
@Index('chunks_workspace_id', ['workspaceId'])
@Index('chunks_bot_id', ['botId'])
@Index('chunks_document_version_id', ['documentVersionId'])
// One row per ordinal per version and model: a retried embedding pass cannot duplicate chunks.
@Index('chunks_version_model_ordinal', ['documentVersionId', 'embeddingModel', 'ordinal'], {
  unique: true,
})
@Index('chunks_embedding_384_hnsw', { synchronize: false })
@Index('chunks_embedding_768_hnsw', { synchronize: false })
@Index('chunks_embedding_1024_hnsw', { synchronize: false })
@Index('chunks_embedding_1536_hnsw', { synchronize: false })
@Index('chunks_embedding_3072_hnsw_halfvec', { synchronize: false })
@Index('chunks_tsv_gin', { synchronize: false })
export class ChunkEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'chunks_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  botId!: string;

  @ManyToOne(() => BotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bot_id', foreignKeyConstraintName: 'chunks_bot_id_fkey' })
  bot!: BotEntity;

  @Column({ type: 'uuid' })
  documentVersionId!: string;

  @ManyToOne(() => DocumentVersionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'document_version_id',
    foreignKeyConstraintName: 'chunks_document_version_id_fkey',
  })
  documentVersion!: DocumentVersionEntity;

  /** Position within the document. */
  @Column({ type: 'int' })
  ordinal!: number;

  /** e.g. "Billing > Refunds". */
  @Column({ type: 'text', nullable: true })
  headingPath!: string | null;

  @Column({ type: 'text' })
  content!: string;

  /** e.g. `{ "pages": [3, 4] }` for PDFs. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @Column({ type: 'int' })
  tokenCount!: number;

  /** Duplicate detection (Phase 2). */
  @Column({ type: 'text', nullable: true })
  contentHash!: string | null;

  /** Untyped `vector`; TypeORM maps it to and from `number[]`. Never selected by default. */
  @Column({ type: 'vector', select: false })
  embedding!: number[];

  @Column({ type: 'text' })
  embeddingModel!: string;

  @Column({ type: 'int' })
  embeddingDim!: number;

  /** Hybrid search (Phase 3). */
  @Column({
    type: 'tsvector',
    generatedType: 'STORED',
    asExpression: "to_tsvector('simple', content)",
    select: false,
    insert: false,
    update: false,
  })
  tsv!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
