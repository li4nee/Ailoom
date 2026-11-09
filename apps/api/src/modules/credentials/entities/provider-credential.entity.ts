// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { PROVIDER_KINDS, type ProviderKind } from '@app/shared';

const providerKinds = [...(PROVIDER_KINDS as unknown as string[])];

@Entity('provider_credentials')
@Index(['workspaceId', 'name'], { unique: true })
@Index(['workspaceId', 'provider'])
export class ProviderCredentialEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({
    type: 'enum',
    enum: providerKinds,
    enumName: 'provider_kind',
  })
  provider!: ProviderKind;

  @Column({ type: 'varchar', length: 500, nullable: true })
  apiKey!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  baseUrl!: string | null;

  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
