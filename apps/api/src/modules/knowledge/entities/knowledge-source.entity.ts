// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { SOURCE_TYPES, SOURCE_STATUSES, type SourceType, type SourceStatus } from '@app/shared';

const sourceTypes = [...(SOURCE_TYPES as unknown as string[])];
const sourceStatuses = [...(SOURCE_STATUSES as unknown as string[])];

@Entity('knowledge_sources')
@Index(['workspaceId', 'name'], { unique: true })
@Index(['workspaceId', 'type'])
export class KnowledgeSourceEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({
    type: 'enum',
    enum: sourceTypes,
    enumName: 'source_type',
  })
  type!: SourceType;

  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: sourceStatuses,
    enumName: 'source_status',
    default: 'pending',
  })
  status!: SourceStatus;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  documentCount!: number;

  @Column({ type: 'int', default: 0 })
  chunkCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
