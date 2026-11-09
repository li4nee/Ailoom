// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

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

@Entity('prompt_versions')
@Index(['botId', 'version'], { unique: true })
@Index(['botId', 'isActive'])
export class PromptVersionEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  botId!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'text' })
  systemPrompt!: string;

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

  @Column({ type: 'boolean', default: false })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
