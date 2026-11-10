// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { NO_ANSWER_BEHAVIORS, type NoAnswerBehavior } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { ProviderCredentialEntity } from '../credentials';
import { WorkspaceEntity } from '../workspaces';

/** A support bot: models, prompt, retrieval and widget settings (spec §9.2). */
@Entity({ name: 'bots' })
@Index('bots_workspace_id', ['workspaceId'])
@Unique('bots_public_key_key', ['publicKey'])
export class BotEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'bots_workspace_id_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'text' })
  name!: string;

  /** `pk_live_…`, embedded in the widget snippet. */
  @Column({ type: 'text' })
  publicKey!: string;

  /** Empty = widget disabled (safe default). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  allowedOrigins!: string[];

  @Column({ type: 'uuid' })
  chatCredentialId!: string;

  // NO ACTION (not RESTRICT): checked at the end of the statement, so deleting a workspace
  // can cascade to both its bots and its credentials. Deleting a credential in use fails.
  @ManyToOne(() => ProviderCredentialEntity)
  @JoinColumn({
    name: 'chat_credential_id',
    foreignKeyConstraintName: 'bots_chat_credential_id_fkey',
  })
  chatCredential!: ProviderCredentialEntity;

  @Column({ type: 'text' })
  chatModel!: string;

  @Column({ type: 'uuid' })
  embeddingCredentialId!: string;

  @ManyToOne(() => ProviderCredentialEntity)
  @JoinColumn({
    name: 'embedding_credential_id',
    foreignKeyConstraintName: 'bots_embedding_credential_id_fkey',
  })
  embeddingCredential!: ProviderCredentialEntity;

  /** Changing it triggers a re-embed (spec §12.7). */
  @Column({ type: 'text' })
  embeddingModel!: string;

  /** Resolved from the model; updated only when a re-embed swap completes. */
  @Column({ type: 'int' })
  embeddingDim!: number;

  /** Set while a re-embed is running; null otherwise. */
  @Column({ type: 'text', nullable: true })
  pendingEmbeddingModel!: string | null;

  /**
   * Null only until the first prompt version is saved. A bare foreign key, with no relation
   * property: prompt versions point back at their bot, and a navigation property here would
   * make the two files import each other (dependency rule no-circular counts type imports).
   */
  @ForeignKey('PromptVersionEntity', {
    name: 'bots_active_prompt_version_id_fkey',
    onDelete: 'SET NULL',
  })
  @Column({ type: 'uuid', nullable: true })
  activePromptVersionId!: string | null;

  /** Minimum similarity for "relevant" (spec §13.3). */
  @Column({ type: 'real', default: 0.35 })
  retrievalThreshold!: number;

  @Column({
    type: 'enum',
    enum: NO_ANSWER_BEHAVIORS,
    enumName: 'no_answer_behavior',
    default: 'offer_handoff',
  })
  noAnswerBehavior!: NoAnswerBehavior;

  @Column({ type: 'boolean', default: true })
  handoffEnabled!: boolean;

  /** Null = no cap. numeric: the pg driver returns a string. */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  monthlySpendCapUsd!: string | null;

  /** Display name, theme color, avatar, position, welcome message, `privacyUrl`. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  appearance!: Record<string, unknown>;

  /** Shown when there is no answer; operator-defined, never hardcoded. */
  @Column({ type: 'text', nullable: true })
  fallbackMessage!: string | null;

  /** Shown after a handoff request. */
  @Column({ type: 'text', nullable: true })
  handoffMessage!: string | null;

  /** Handoff-intent phrases (spec §14.1); null = built-in defaults. */
  @Column({ type: 'text', array: true, nullable: true })
  handoffPhrases!: string[] | null;

  /** Extra domains AI answers may link to (spec §13.6). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  allowedLinkDomains!: string[];

  /** Proof-of-work challenge on widget session create (spec §10.4). */
  @Column({ type: 'boolean', default: false })
  requireChallenge!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
