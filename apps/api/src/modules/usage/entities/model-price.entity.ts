// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { PROVIDER_KINDS, type ProviderKind } from '@app/shared';

const providerKinds = [...(PROVIDER_KINDS as unknown as string[])];

@Entity('model_prices')
@Index(['provider', 'model', 'workspaceId'], { unique: true })
export class ModelPriceEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({
    type: 'enum',
    enum: providerKinds,
    enumName: 'provider_kind',
  })
  provider!: ProviderKind;

  @Column({ type: 'varchar', length: 255 })
  model!: string;

  @Column({ type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  inputPricePer1k!: number;

  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  outputPricePer1k!: number;

  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  embeddingPricePer1k!: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;
}
