// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import {
  NO_ANSWER_BEHAVIORS,
  PRIORITIES,
  CHANNELS,
  type NoAnswerBehavior,
  type Priority,
  type Channel,
} from '@app/shared';

const noAnswerBehaviors = [...(NO_ANSWER_BEHAVIORS as unknown as string[])];
const priorities = [...(PRIORITIES as unknown as string[])];
const channels = [...(CHANNELS as unknown as string[])];

@Entity('bots')
@Index(['workspaceId', 'name'], { unique: true })
@Index(['workspaceId', 'credentialId'])
export class BotEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid', nullable: true })
  credentialId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  systemPrompt!: string | null;

  @Column({ type: 'int', default: 0 })
  temperature!: number;

  @Column({ type: 'int', nullable: true })
  maxOutputTokens!: number | null;

  @Column({
    type: 'enum',
    enum: noAnswerBehaviors,
    enumName: 'no_answer_behavior',
    default: 'handoff',
  })
  noAnswerBehavior!: NoAnswerBehavior;

  @Column({ type: 'text', nullable: true })
  handoffMessage!: string | null;

  @Column({ type: 'text', array: true, default: [] })
  handoffPhrases!: string[];

  @Column({ type: 'varchar', length: 255, array: true, default: [] })
  allowedLinkDomains!: string[];

  @Column({ type: 'varchar', length: 255, array: true, default: [] })
  allowedOrigins!: string[];

  @Column({ type: 'boolean', default: false })
  requireChallenge!: boolean;

  @Column({
    type: 'enum',
    enum: priorities,
    enumName: 'priority',
    default: 'normal',
  })
  priority!: Priority;

  @Column({
    type: 'enum',
    enum: channels,
    enumName: 'channel',
    default: 'web',
  })
  channel!: Channel;

  @Column({ type: 'int', default: 0 })
  tokenVersion!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  pendingEmbeddingModel!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
