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

import { WorkspaceEntity } from '../workspaces';

/** An uploaded file's metadata; the bytes live in file storage under `storageKey`. */
@Entity({ name: 'files' })
@Index('files_workspace_id', ['workspaceId'])
export class FileEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'text' })
  storageKey!: string;

  @Column({ type: 'text' })
  filename!: string;

  @Column({ type: 'text' })
  mimeType!: string;

  @Column({ type: 'bigint' })
  sizeBytes!: string;

  @Column({ type: 'text' })
  sha256!: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'files_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
