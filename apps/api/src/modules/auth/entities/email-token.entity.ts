// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { EMAIL_TOKEN_TYPES, type EmailTokenType } from '@app/shared';

import { UserEntity } from './user.entity';

@Entity({ name: 'email_tokens' })
@Index('email_tokens_token_hash_key', ['tokenHash'], { unique: true })
export class EmailTokenEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'email_tokens_user_id_fkey' })
  user!: UserEntity | null;

  @Column({ type: 'enum', enum: EMAIL_TOKEN_TYPES, enumName: 'email_token_type' })
  type!: EmailTokenType;

  @Column({ type: 'text' })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;
}
