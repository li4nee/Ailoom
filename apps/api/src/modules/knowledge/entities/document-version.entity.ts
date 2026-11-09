// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import type { ExtractionWarning } from '@app/shared';

@Entity('document_versions')
@Index(['documentId', 'version'], { unique: true })
@Index(['workspaceId', 'documentId'])
export class DocumentVersionEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'text' })
  contentHash!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title!: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  chunkCount!: number;

  @Column({ type: 'int', default: 0 })
  tokenCount!: number;

  @Column({ type: 'varchar', length: 100, array: true, default: [] })
  warnings!: ExtractionWarning[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
