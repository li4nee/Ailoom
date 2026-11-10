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

import { UserEntity } from './user.entity';

/** Why a session row was revoked; written by `SessionsService` and surfaced in spec §9.1. */
export const REVOKED_REASONS = [
  'rotated',
  'logout',
  'logout_all',
  'reuse_detected',
  'password_change',
] as const;
export type RevokedReason = (typeof REVOKED_REASONS)[number];

@Entity({ name: 'auth_sessions' })
@Index('auth_sessions_user_active', ['userId'], {
  where: '"revoked_at" IS NULL',
})
@Index('auth_sessions_refresh_token_hash_key', ['refreshTokenHash'], { unique: true })
export class AuthSessionEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'auth_sessions_user_id_fkey' })
  user!: UserEntity;

  @Column({ type: 'text' })
  refreshTokenHash!: string;

  @Column({ type: 'uuid' })
  familyId!: string;

  @Column({ type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'text', nullable: true })
  ip!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  revokedReason!: RevokedReason | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
