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

@Entity({ name: 'audit_log' })
@Index('audit_log_workspace_id', ['workspaceId'])
export class AuditLogEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'text' })
  action!: string;

  @Column({ type: 'text', nullable: true })
  targetType!: string | null;

  @Column({ type: 'uuid', nullable: true })
  targetId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  // String targets keep the foreign keys in the schema without importing another module's barrel.
  @ManyToOne('WorkspaceEntity', { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'audit_log_workspace_id_fkey',
  })
  workspace!: unknown;

  @ManyToOne('UserEntity', { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'audit_log_actor_user_id_fkey',
  })
  actorUser!: unknown;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
