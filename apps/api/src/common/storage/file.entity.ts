// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';

import type { WorkspaceEntity } from '../../modules/workspaces';

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

  // By entity name, with a type-only import: src/common must not depend on feature modules at
  // runtime (dependency rule common-is-leaf).
  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'files_workspace_id_fkey' })
  workspace!: Relation<WorkspaceEntity>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
