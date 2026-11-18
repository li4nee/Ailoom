// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { ContactId, WorkspaceId } from '../../db/ids';
import { TenantEntity } from '../../db/tenant-entity';
import { ContactEntity } from '../conversations/entities/contact.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { IntegrationEntity } from './integration.entity';

/** Maps an AiLoom contact to one external provider object without overloading contacts.externalId. */
@Entity({ name: 'contact_external_links' })
@Index('contact_external_links_workspace_id', ['workspaceId'])
@Index(
  'contact_external_links_provider_object_key',
  ['integrationId', 'objectType', 'externalObjectId'],
  {
    unique: true,
  },
)
@Index('contact_external_links_idempotency_key', ['integrationId', 'idempotencyKey'], {
  unique: true,
})
export class IntegrationLinkEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @Column({ type: 'uuid' })
  integrationId!: string;

  @Column({ type: 'uuid' })
  contactId!: ContactId;

  @Column({ type: 'text' })
  objectType!: string;

  @Column({ type: 'text' })
  externalObjectId!: string;

  @Column({ type: 'text' })
  idempotencyKey!: string;

  @ManyToOne(() => IntegrationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'integration_id',
    foreignKeyConstraintName: 'contact_external_links_integration_id_fkey',
  })
  integration!: IntegrationEntity;

  @ManyToOne(() => ContactEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'contact_id',
    foreignKeyConstraintName: 'contact_external_links_contact_id_fkey',
  })
  contact!: ContactEntity;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'contact_external_links_workspace_id_fkey',
  })
  workspace!: WorkspaceEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
