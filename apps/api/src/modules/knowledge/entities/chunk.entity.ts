// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('chunks')
@Index(['workspaceId', 'documentId'])
@Index(['workspaceId', 'documentVersionId'])
@Index(['workspaceId', 'embeddingDim'])
export class ChunkEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @Column({ type: 'uuid' })
  documentVersionId!: string;

  @Column({ type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'int' })
  tokenCount!: number;

  // Embedding is stored as vector(1536) in DB (set by migration).
  // TypeORM doesn't have native vector support, so we use text with select: false
  // and handle vector operations via raw queries or a custom transformer.
  @Column({ type: 'text', select: false, nullable: true })
  embedding!: string | null;

  @Column({ type: 'int', nullable: true })
  embeddingDim!: number | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  // Generated tsv column for full-text search (updated by trigger)
  @Column({ type: 'tsvector', select: false, nullable: true })
  tsv!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
