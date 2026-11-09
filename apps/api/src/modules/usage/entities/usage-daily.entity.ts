// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// Branded IDs used at application layer; DB stores plain UUID strings

@Entity('usage_daily')
@Index(['workspaceId', 'date'], { unique: true })
@Index(['workspaceId', 'botId', 'date'])
export class UsageDailyEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid', nullable: true })
  botId!: string | null;

  @Column({ type: 'date' })
  date!: string; // YYYY-MM-DD

  @Column({ type: 'bigint', default: 0 })
  inputTokens!: number;

  @Column({ type: 'bigint', default: 0 })
  outputTokens!: number;

  @Column({ type: 'bigint', default: 0 })
  embeddingTokens!: number;

  @Column({ type: 'bigint', default: 0 })
  requestCount!: number;

  @Column({ type: 'bigint', default: 0 })
  errorCount!: number;
}
