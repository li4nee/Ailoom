// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { WorkspaceEntity } from '../../workspaces';

/** A visitor/customer: anonymous in Phase 1, identified in Phase 2 (spec §9.4). */
@Entity({ name: 'contacts' })
@Index('contacts_workspace_id', ['workspaceId'])
@Index('contacts_workspace_id_external_id_key', ['workspaceId', 'externalId'], {
  unique: true,
  where: '"external_id" IS NOT NULL',
})
export class ContactEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'contacts_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  /** Phase 2: the host app's user id; unique per workspace when set. */
  @Column({ type: 'text', nullable: true })
  externalId!: string | null;

  /** Collected optionally in Phase 1 (handoff form). */
  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  /** Phase 2. */
  @Column({ type: 'jsonb', nullable: true })
  attributes!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}
