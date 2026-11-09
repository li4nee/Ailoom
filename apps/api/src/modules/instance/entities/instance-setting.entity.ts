// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { UserEntity } from '../../auth/entities/user.entity';

@Entity({ name: 'instance_settings' })
export class InstanceSettingEntity {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'instance_settings_updated_by_fkey',
  })
  updatedByUser!: UserEntity | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
