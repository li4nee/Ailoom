// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { DOCUMENT_STATUSES, type DocumentStatus } from '@app/shared';

const documentStatuses = [...(DOCUMENT_STATUSES as unknown as string[])];

@Entity('documents')
@Index(['workspaceId', 'sourceId'])
@Index(['workspaceId', 'externalId'])
@Index(['workspaceId', 'status'])
export class DocumentEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid' })
  sourceId!: string;

  @Column({ type: 'varchar', length: 500 })
  externalId!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  contentHash!: string | null;

  @Column({
    type: 'enum',
    enum: documentStatuses,
    enumName: 'document_status',
    default: 'pending',
  })
  status!: DocumentStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'int', default: 0 })
  chunkCount!: number;

  @Column({ type: 'int', default: 0 })
  tokenCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
